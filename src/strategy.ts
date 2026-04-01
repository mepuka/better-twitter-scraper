import { Effect, Layer, Option, ServiceMap } from "effect";

import type * as Cookies from "effect/unstable/http/Cookies";

import { CookieManager } from "./cookies";
import {
  AuthenticationError,
  BotDetectionError,
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  ProfileNotFoundError,
  RateLimitError,
  TransportError,
} from "./errors";
import {
  classifyHttpStatusError,
  decodeParsedBody,
} from "./http-client-utils";
import { TwitterHttpClient } from "./http";
import {
  logDebugDecision,
  requestLogAnnotations,
  TransportMetadata,
  type TransportName,
} from "./observability";
import { RateLimiter } from "./rate-limiter";
import {
  GuestRequestAuth,
  type RequestAuthError,
  type RequestAuthHelper,
  UserRequestAuth,
} from "./request-auth";
import {
  prepareApiRequest,
  type ApiRequest,
  type PreparedApiRequest,
} from "./request";

export type StrategyError =
  | AuthenticationError
  | BotDetectionError
  | GuestTokenError
  | HttpStatusError
  | InvalidResponseError
  | ProfileNotFoundError
  | RateLimitError
  | RequestAuthError
  | TransportError;

export interface StrategyCookies {
  readonly applySetCookies: (
    setCookies: Cookies.Cookies,
  ) => Effect.Effect<void>;
}

interface StrategyTransport {
  readonly execute: <A>(
    request: PreparedApiRequest<A>,
  ) => Effect.Effect<
    {
      readonly headers: Readonly<Record<string, string>>;
      readonly cookies: Cookies.Cookies;
      readonly body: string | unknown;
    },
    HttpStatusError | InvalidResponseError | TransportError
  >;
}

interface StrategyRateLimiter {
  readonly awaitReady: (
    bucket: ApiRequest<unknown>["rateLimitBucket"],
  ) => Effect.Effect<void>;
  readonly noteRateLimit: (
    error: RateLimitError,
  ) => Effect.Effect<void>;
  readonly noteResponse: (options: {
    readonly bucket: ApiRequest<unknown>["rateLimitBucket"];
    readonly headers: Readonly<Record<string, string>>;
  }) => Effect.Effect<{
    readonly incomingExhausted: boolean;
  }>;
}

export const createStrategyExecute = (
  auth: {
    readonly guest: Option.Option<RequestAuthHelper>;
    readonly user: Option.Option<RequestAuthHelper>;
  },
  cookies: StrategyCookies,
  http: StrategyTransport,
  rateLimiter: StrategyRateLimiter,
  transport: TransportName,
) => {
  const resolveRequestAuth = (
    request: ApiRequest<unknown>,
  ): Effect.Effect<RequestAuthHelper, AuthenticationError | GuestTokenError> =>
    request.authRequirement === "guest"
      ? Option.match(auth.guest, {
          onNone: () =>
            Effect.fail(
              new GuestTokenError({
                reason: `${request.endpointId} requires guest request auth, but GuestAuth was not provided.`,
              }),
            ),
          onSome: Effect.succeed,
        })
      : Option.match(auth.user, {
          onNone: () =>
            Effect.fail(
              new AuthenticationError({
                reason: `${request.endpointId} requires authenticated request auth, but UserAuth was not provided.`,
              }),
            ),
          onSome: Effect.succeed,
        });

  const executeOnce = <A>(
    request: ApiRequest<A>,
  ): Effect.Effect<A, StrategyError> =>
    Effect.gen(function* () {
      const requestAuth = yield* resolveRequestAuth(request);
      yield* rateLimiter.awaitReady(request.rateLimitBucket);
      const headers = yield* requestAuth.headersFor(request);
      const response = yield* http.execute(prepareApiRequest(request, headers));

      yield* cookies.applySetCookies(response.cookies);

      const limiterResult = yield* rateLimiter.noteResponse({
        bucket: request.rateLimitBucket,
        headers: response.headers,
      });

      if (
        limiterResult.incomingExhausted &&
        request.authRequirement === "guest" &&
        request.bearerToken === "default"
      ) {
        yield* logDebugDecision("Guest token invalidated from warning header", {
          warning_header: "x-rate-limit-incoming",
          warning_value: "0",
        });
        yield* requestAuth.invalidate;
      }

      return yield* decodeParsedBody(request, response.body);
    });

  const executeWithRetry = <A>(
    request: ApiRequest<A>,
    attempt = 0,
  ): Effect.Effect<A, StrategyError> =>
    executeOnce(request).pipe(
      Effect.catchTag("HttpStatusError", (error) => {
        if (
          attempt === 0 &&
          request.authRequirement === "guest" &&
          request.bearerToken === "default" &&
          (error.status === 401 || error.status === 403)
        ) {
          return Effect.gen(function* () {
            const requestAuth = yield* resolveRequestAuth(request);

            yield* logDebugDecision("Guest auth refresh scheduled after 401/403", {
              status: error.status,
            });
            yield* requestAuth.invalidate;
            return yield* executeWithRetry(request, attempt + 1);
          });
        }

        const classified = classifyHttpStatusError(request, error);

        if (classified._tag === "RateLimitError") {
          return rateLimiter.noteRateLimit(classified).pipe(
            Effect.tap(() =>
              attempt === 0
                ? logDebugDecision("429 retry scheduled", {
                    status: classified.status,
                    ...(classified.reset !== undefined
                      ? { reset_at: classified.reset }
                      : {}),
                  })
                : Effect.void,
            ),
            Effect.flatMap(() =>
              attempt === 0
                ? executeWithRetry(request, attempt + 1)
                : Effect.fail(classified),
            ),
          );
        }

        if (classified._tag === "BotDetectionError") {
          return logDebugDecision("Bot detection classified", {
            status: classified.status,
            reason: classified.reason,
          }).pipe(Effect.andThen(() => Effect.fail(classified)));
        }

        return Effect.fail(classified);
      }),
      Effect.annotateLogs(
        requestLogAnnotations(request, {
          retryAttempt: attempt,
          transport,
        }),
      ),
      Effect.withSpan("ScraperStrategy.execute", {
        attributes: requestLogAnnotations(request, {
          retryAttempt: attempt,
          transport,
        }),
      }),
    );

  return <A>(request: ApiRequest<A>): Effect.Effect<A, StrategyError> =>
    executeWithRetry(request);
};

export class ScraperStrategy extends ServiceMap.Service<
  ScraperStrategy,
  {
    readonly execute: <A>(
      request: ApiRequest<A>,
    ) => Effect.Effect<A, StrategyError>;
  }
>()("@better-twitter-scraper/ScraperStrategy") {
  static get standardLayer() {
    return Layer.effect(
      ScraperStrategy,
      Effect.gen(function* () {
        const guest = yield* Effect.serviceOption(GuestRequestAuth);
        const user = yield* Effect.serviceOption(UserRequestAuth);
        const cookies = yield* CookieManager;
        const http = yield* TwitterHttpClient;
        const transport = yield* TransportMetadata;
        const rateLimiter = yield* RateLimiter;

        return {
          execute: createStrategyExecute(
            {
              guest,
              user,
            },
            cookies,
            http,
            rateLimiter,
            transport.name,
          ),
        };
      }),
    ).pipe(Layer.provideMerge(RateLimiter.liveLayer));
  }
}
