import { Duration, Effect, Layer, Option, Schedule, ServiceMap } from "effect";

import type * as Cookies from "effect/unstable/http/Cookies";

import { TwitterConfig } from "./config";
import { CookieManager } from "./cookies";
import {
  AuthenticationError,
  BotDetectionError,
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  ProfileNotFoundError,
  RateLimitError,
  TweetNotFoundError,
  TransportError,
} from "./errors";
import {
  classifyHttpStatusError,
  decodeParsedBody,
} from "./http-client-utils";
import { TwitterEndpointCatalog } from "./endpoint-catalog";
import { TwitterEndpointDiscovery } from "./endpoint-discovery";
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
  | TweetNotFoundError
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

interface StrategyEndpointCatalog {
  readonly resolveRequest: <A>(
    request: ApiRequest<A>,
  ) => Effect.Effect<ApiRequest<A>>;
  readonly updateQueryIds: (
    discovered: ReadonlyMap<string, string>,
  ) => Effect.Effect<void>;
}

type StrategyDiscovery = Option.Option<{
  readonly refreshQueryIds: () => Effect.Effect<
    ReadonlyMap<string, string>,
    HttpStatusError | InvalidResponseError | TransportError
  >;
}>;

export const createStrategyExecute = (
  auth: {
    readonly guest: Option.Option<RequestAuthHelper>;
    readonly user: Option.Option<RequestAuthHelper>;
  },
  cookies: StrategyCookies,
  http: StrategyTransport,
  rateLimiter: StrategyRateLimiter,
  transport: TransportName,
  endpointCatalog: StrategyEndpointCatalog,
  discovery: StrategyDiscovery,
  retryLimit = 1,
  requestTimeout: Duration.Duration = Duration.millis(30_000),
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

  const isEmptyGraphqlNotFound = (
    request: ApiRequest<unknown>,
    error: HttpStatusError,
  ) =>
    request.graphqlOperationName !== undefined &&
    (request.family === "graphql" || request.family === "graphqlAlt") &&
    error.status === 404 &&
    error.body.trim().length === 0;

  const executeOnce = <A>(
    request: ApiRequest<A>,
  ): Effect.Effect<A, StrategyError> =>
    Effect.gen(function* () {
      const resolvedRequest = yield* endpointCatalog.resolveRequest(request);
      const requestAuth = yield* resolveRequestAuth(resolvedRequest);
      yield* rateLimiter.awaitReady(resolvedRequest.rateLimitBucket);
      const headers = yield* requestAuth.headersFor(resolvedRequest);
      const response = yield* http.execute(
        prepareApiRequest(resolvedRequest, headers),
      ).pipe(
        Effect.timeoutOrElse({
          duration: requestTimeout,
          orElse: () =>
            Effect.fail(
              new TransportError({
                url: resolvedRequest.url,
                reason: `Request to ${resolvedRequest.endpointId} timed out after ${Duration.toMillis(requestTimeout)}ms`,
                error: new Error("timeout"),
              }),
            ),
        }),
        Effect.retry({
          while: (error) => error._tag === "TransportError",
          times: 2,
          schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
        }),
      );

      yield* cookies.applySetCookies(response.cookies);

      const limiterResult = yield* rateLimiter.noteResponse({
        bucket: resolvedRequest.rateLimitBucket,
        headers: response.headers,
      });

      if (
        limiterResult.incomingExhausted &&
        resolvedRequest.authRequirement === "guest" &&
        resolvedRequest.bearerToken === "default"
      ) {
        yield* logDebugDecision("Guest token invalidated from warning header", {
          warning_header: "x-rate-limit-incoming",
          warning_value: "0",
        });
        yield* requestAuth.invalidate;
      }

      return yield* decodeParsedBody(resolvedRequest, response.body);
    });

  const executeWithRetry = <A>(
    request: ApiRequest<A>,
    attempt = 0,
    refreshedQueryIds = false,
  ): Effect.Effect<A, StrategyError> =>
    executeOnce(request).pipe(
      Effect.catchTag("HttpStatusError", (error) => {
        if (
          !refreshedQueryIds &&
          Option.isSome(discovery) &&
          isEmptyGraphqlNotFound(request, error)
        ) {
          return Effect.gen(function* () {
            const discovered = yield* discovery.value.refreshQueryIds().pipe(
              Effect.orElseSucceed(() => new Map<string, string>()),
            );

            if (discovered.size > 0) {
              yield* endpointCatalog.updateQueryIds(discovered);
            }

            yield* logDebugDecision(
              "Query ID refresh scheduled after empty GraphQL 404",
              {
                endpoint_id: request.endpointId,
                operation_name: request.graphqlOperationName,
              },
            );

            return yield* executeWithRetry(request, attempt, true);
          });
        }

        if (
          attempt < retryLimit &&
          request.authRequirement === "guest" &&
          (error.status === 401 || error.status === 403)
        ) {
          return Effect.gen(function* () {
            const requestAuth = yield* resolveRequestAuth(request);

            yield* logDebugDecision("Guest auth refresh scheduled after 401/403", {
              status: error.status,
            });
            yield* requestAuth.invalidate;
            return yield* executeWithRetry(request, attempt + 1, refreshedQueryIds);
          });
        }

        const classified = classifyHttpStatusError(request, error);

        if (classified._tag === "RateLimitError") {
          return rateLimiter.noteRateLimit(classified).pipe(
            Effect.tap(() =>
              attempt < retryLimit
                ? logDebugDecision("429 retry scheduled", {
                    status: classified.status,
                    ...(classified.reset !== undefined
                      ? { reset_at: classified.reset }
                      : {}),
                  })
                : Effect.void,
            ),
            Effect.flatMap(() =>
              attempt < retryLimit
                ? executeWithRetry(request, attempt + 1, refreshedQueryIds)
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
        const config = yield* TwitterConfig;
        const guest = yield* Effect.serviceOption(GuestRequestAuth);
        const user = yield* Effect.serviceOption(UserRequestAuth);
        const cookies = yield* CookieManager;
        const http = yield* TwitterHttpClient;
        const transport = yield* TransportMetadata;
        const rateLimiter = yield* RateLimiter;
        const endpointCatalog = yield* TwitterEndpointCatalog;

        const discovery = yield* Effect.serviceOption(TwitterEndpointDiscovery);
        if (Option.isSome(discovery)) {
          const discovered = yield* discovery.value.discoverQueryIds().pipe(
            Effect.orElseSucceed(() => new Map<string, string>()),
          );
          if (discovered.size > 0) {
            yield* endpointCatalog.updateQueryIds(discovered);
          }
        }

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
            endpointCatalog,
            discovery,
            config.strategy.retryLimit,
            config.requestTimeout,
          ),
        };
      }),
    ).pipe(
      Layer.provideMerge(TwitterEndpointCatalog.liveLayer),
      Layer.provideMerge(RateLimiter.liveLayer),
    );
  }
}
