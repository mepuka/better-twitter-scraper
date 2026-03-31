import { Effect, Layer, ServiceMap } from "effect";

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
import { RateLimiter } from "./rate-limiter";
import { RequestAuth, type RequestAuthError } from "./request-auth";
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

interface StrategyRequestAuth {
  readonly headersFor: (
    request: ApiRequest<unknown>,
  ) => Effect.Effect<Readonly<Record<string, string>>, RequestAuthError>;
  readonly invalidate: Effect.Effect<void>;
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
  auth: StrategyRequestAuth,
  cookies: StrategyCookies,
  http: StrategyTransport,
  rateLimiter: StrategyRateLimiter,
) => {
  const executeOnce = <A>(
    request: ApiRequest<A>,
  ): Effect.Effect<A, StrategyError> =>
    Effect.gen(function* () {
      yield* rateLimiter.awaitReady(request.rateLimitBucket);
      const headers = yield* auth.headersFor(request);
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
        yield* auth.invalidate;
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
          request.bearerToken === "default" &&
          (error.status === 401 || error.status === 403)
        ) {
          return auth.invalidate.pipe(
            Effect.flatMap(() => executeWithRetry(request, attempt + 1)),
          );
        }

        const classified = classifyHttpStatusError(request, error);

        if (classified._tag === "RateLimitError") {
          return rateLimiter.noteRateLimit(classified).pipe(
            Effect.flatMap(() =>
              attempt === 0
                ? executeWithRetry(request, attempt + 1)
                : Effect.fail(classified),
            ),
          );
        }

        return Effect.fail(classified);
      }),
      Effect.withSpan(`ScraperStrategy.execute.${request.endpointId}`),
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
        const auth = yield* RequestAuth;
        const cookies = yield* CookieManager;
        const http = yield* TwitterHttpClient;
        const rateLimiter = yield* RateLimiter;

        return {
          execute: createStrategyExecute(auth, cookies, http, rateLimiter),
        };
      }),
    ).pipe(Layer.provideMerge(RateLimiter.liveLayer));
  }
}
