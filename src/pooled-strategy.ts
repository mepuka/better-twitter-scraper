import { Effect, Layer, Option, Ref, ServiceMap } from "effect";

import { TwitterConfig } from "./config";
import type { SerializedCookie } from "./cookies";
import { TwitterEndpointDiscovery } from "./endpoint-discovery";
import { updateQueryIds } from "./endpoints";
import { AuthenticationError } from "./errors";
import { TwitterHttpClient } from "./http";
import { logDebugDecision, TransportMetadata } from "./observability";
import type { BucketState } from "./rate-limiter";
import type { RateLimitBucket } from "./request";
import {
  createSessionCapsule,
  type SessionCapsule,
} from "./session-capsule";
import {
  createStrategyExecute,
  ScraperStrategy,
  type StrategyError,
} from "./strategy";
import { TwitterTransactionId } from "./transaction-id";

/**
 * A snapshot of a single session for observability / introspection.
 */
export interface SessionSnapshot {
  readonly id: number;
  readonly hasUserAuth: boolean;
}

/**
 * Session management service — add sessions and inspect pool state.
 * Separate from request execution (ScraperStrategy).
 */
export class SessionPoolManager extends ServiceMap.Service<
  SessionPoolManager,
  {
    readonly addSession: (
      cookies: ReadonlyArray<SerializedCookie>,
    ) => Effect.Effect<void>;
    readonly sessionCount: Effect.Effect<number>;
    readonly snapshot: Effect.Effect<ReadonlyArray<SessionSnapshot>>;
  }
>()("@better-twitter-scraper/SessionPoolManager") {}

// ---------------------------------------------------------------------------
// Internal shared-state service — holds the capsules Ref and exposes both
// the ScraperStrategy and SessionPoolManager interfaces.
// ---------------------------------------------------------------------------

/** @internal */
export interface PooledInternals {
  readonly strategy: {
    readonly execute: <A>(
      request: import("./request").ApiRequest<A>,
    ) => Effect.Effect<A, StrategyError>;
  };
  readonly manager: {
    readonly addSession: (
      cookies: ReadonlyArray<SerializedCookie>,
    ) => Effect.Effect<void>;
    readonly sessionCount: Effect.Effect<number>;
    readonly snapshot: Effect.Effect<ReadonlyArray<SessionSnapshot>>;
  };
}

class PooledInternals_ extends ServiceMap.Service<
  PooledInternals_,
  PooledInternals
>()("@better-twitter-scraper/PooledInternals_") {}

// ---------------------------------------------------------------------------
// Rate-limit-based sorting
// ---------------------------------------------------------------------------

const sortByRateLimitState = (
  capsules: ReadonlyArray<SessionCapsule>,
  bucket: RateLimitBucket,
) =>
  Effect.gen(function* () {
    const withState = yield* Effect.all(
      capsules.map((c) =>
        c.rateLimiter.snapshot(bucket).pipe(
          Effect.map((state) => ({ capsule: c, state })),
        ),
      ),
    );

    const nowEpochSec = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();

    const isAvailable = (s: BucketState) => {
      // A session is blocked if blockedUntil is in the future
      if (s.blockedUntil !== undefined && s.blockedUntil > nowMs) return false;
      // Or if reset is in the future and remaining is 0
      if (s.reset !== undefined && s.reset > nowEpochSec && s.remaining === 0) return false;
      return true;
    };

    const availableAt = (s: BucketState) => {
      // When will this session next be available? (in ms from epoch)
      const resetMs = s.reset !== undefined ? s.reset * 1000 : Infinity;
      const blockedMs = s.blockedUntil ?? Infinity;
      return Math.min(resetMs, blockedMs);
    };

    return withState
      .sort((a, b) => {
        // No state = fully available (best)
        if (!a.state && !b.state) return 0;
        if (!a.state) return -1;
        if (!b.state) return 1;

        const aOk = isAvailable(a.state);
        const bOk = isAvailable(b.state);
        if (aOk && !bOk) return -1;
        if (!aOk && bOk) return 1;

        if (aOk && bOk) {
          // Both available — prefer more remaining headroom
          const aRemaining = a.state.remaining ?? Infinity;
          const bRemaining = b.state.remaining ?? Infinity;
          return bRemaining - aRemaining;
        }

        // Both unavailable — prefer the one that becomes available soonest
        return availableAt(a.state) - availableAt(b.state);
      })
      .map((x) => x.capsule);
  });

// ---------------------------------------------------------------------------
// PooledScraperStrategy
// ---------------------------------------------------------------------------

export class PooledScraperStrategy {
  static layer(
    initialSessions: ReadonlyArray<ReadonlyArray<SerializedCookie>> = [],
  ) {
    const internalsLayer = Layer.effect(
      PooledInternals_,
      Effect.gen(function* () {
        const config = yield* TwitterConfig;
        const http = yield* TwitterHttpClient;
        const transactionId = yield* TwitterTransactionId;
        const transport = yield* TransportMetadata;

        const shared = { config, transactionId, http };
        const capsulesRef = yield* Ref.make<ReadonlyArray<SessionCapsule>>(
          [],
        );
        const nextIdRef = yield* Ref.make(0);

        // Optionally discover endpoint IDs
        const discovery = yield* Effect.serviceOption(
          TwitterEndpointDiscovery,
        );
        if (Option.isSome(discovery)) {
          const discovered = yield* discovery.value
            .discoverQueryIds()
            .pipe(
              Effect.orElseSucceed(() => new Map<string, string>()),
            );
          if (discovered.size > 0) {
            updateQueryIds(discovered);
          }
        }

        // Create initial capsules
        for (const cookies of initialSessions) {
          const id = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1);
          const capsule = yield* createSessionCapsule(id, cookies, shared);
          yield* Ref.update(capsulesRef, (cs) => [...cs, capsule]);
        }

        // If no initial sessions, create a guest-only capsule
        if (initialSessions.length === 0) {
          const id = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1);
          const capsule = yield* createSessionCapsule(id, [], shared);
          yield* Ref.update(capsulesRef, (cs) => [...cs, capsule]);
        }

        const addSession = (cookies: ReadonlyArray<SerializedCookie>) =>
          Effect.gen(function* () {
            const id = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1);
            const capsule = yield* createSessionCapsule(
              id,
              cookies,
              shared,
            );
            yield* Ref.update(capsulesRef, (cs) => [...cs, capsule]);
          });

        const rotateOnSessionError = <A>(
          capsuleId: number,
          request: import("./request").ApiRequest<A>,
          remaining: ReadonlyArray<SessionCapsule>,
        ) => {
          const makeRotationHandler = (
            errorTag: string,
          ) =>
            (error: StrategyError) =>
              logDebugDecision("Session failed, rotating to next", {
                session_id: capsuleId,
                error_tag: errorTag,
              }).pipe(
                Effect.flatMap(() =>
                  tryNextCapsule(request, remaining, error),
                ),
              );

          return {
            BotDetectionError: makeRotationHandler("BotDetectionError"),
            AuthenticationError: makeRotationHandler("AuthenticationError"),
            GuestTokenError: makeRotationHandler("GuestTokenError"),
          } as const;
        };

        const tryNextCapsule = <A>(
          request: import("./request").ApiRequest<A>,
          remaining: ReadonlyArray<SessionCapsule>,
          lastError?: StrategyError,
        ): Effect.Effect<A, StrategyError> => {
          if (remaining.length === 0) {
            // Return the last real error, not a synthetic one
            return Effect.fail(
              lastError ??
                new AuthenticationError({
                  reason: `No sessions available in the pool for ${request.endpointId}.`,
                }),
            ) as Effect.Effect<A, StrategyError>;
          }

          const [capsule, ...rest] = remaining;
          const run = createStrategyExecute(
            {
              guest: capsule!.guest,
              user: Option.some(capsule!.user),
            },
            capsule!.cookies,
            http,
            capsule!.rateLimiter,
            transport.name,
            config.strategy.retryLimit,
            config.requestTimeout,
          );

          return run(request).pipe(
            Effect.catchTags(
              rotateOnSessionError(capsule!.id, request, rest),
            ),
          );
        };

        const execute = <A>(
          request: import("./request").ApiRequest<A>,
        ): Effect.Effect<A, StrategyError> =>
          Effect.gen(function* () {
            const capsules = yield* Ref.get(capsulesRef);

            // Filter by auth capability
            const candidates: SessionCapsule[] = [];
            for (const capsule of capsules) {
              if (request.authRequirement === "user") {
                const canHandle = yield* capsule.canHandleUserAuth();
                if (canHandle) candidates.push(capsule);
              } else {
                candidates.push(capsule);
              }
            }

            if (candidates.length === 0) {
              return yield* new AuthenticationError({
                reason:
                  request.authRequirement === "user"
                    ? `No session in the pool can handle ${request.endpointId} (requires authenticated session cookies).`
                    : `No sessions available in the pool for ${request.endpointId}.`,
              });
            }

            // Sort by rate limit state — best first
            const sorted = yield* sortByRateLimitState(
              candidates,
              request.rateLimitBucket,
            );

            return yield* tryNextCapsule(request, sorted);
          });

        const sessionCount = Ref.get(capsulesRef).pipe(
          Effect.map((cs) => cs.length),
        );

        const snapshot = Ref.get(capsulesRef).pipe(
          Effect.flatMap((cs) =>
            Effect.all(
              cs.map((c) =>
                c.canHandleUserAuth().pipe(
                  Effect.map(
                    (hasUserAuth): SessionSnapshot => ({
                      id: c.id,
                      hasUserAuth,
                    }),
                  ),
                ),
              ),
            ),
          ),
        );

        return {
          strategy: { execute },
          manager: { addSession, sessionCount, snapshot },
        } satisfies PooledInternals;
      }),
    );

    const strategyLayer = Layer.effect(
      ScraperStrategy,
      Effect.gen(function* () {
        const internals = yield* PooledInternals_;
        return internals.strategy;
      }),
    );

    const managerLayer = Layer.effect(
      SessionPoolManager,
      Effect.gen(function* () {
        const internals = yield* PooledInternals_;
        return internals.manager;
      }),
    );

    return Layer.mergeAll(strategyLayer, managerLayer).pipe(
      Layer.provideMerge(internalsLayer),
    );
  }
}
