import { Clock, Duration, Effect, Layer, Option, Ref, ServiceMap } from "effect";

import { TwitterConfig } from "./config";
import type { SerializedCookie } from "./cookies";
import { TwitterEndpointCatalog } from "./endpoint-catalog";
import { TwitterEndpointDiscovery } from "./endpoint-discovery";
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
  readonly cooldownUntil?: number;
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
  cooldowns: Readonly<Record<number, number>>,
) =>
  Effect.gen(function* () {
    const withState = yield* Effect.all(
      capsules.map((c) =>
        c.rateLimiter.snapshot(bucket).pipe(
          Effect.map((state) => ({
            capsule: c,
            state,
            cooldownUntil: cooldowns[c.id],
          })),
        ),
      ),
    );

    const nowMs = yield* Clock.currentTimeMillis;
    const nowEpochSec = Math.floor(nowMs / 1000);

    const rateLimitAvailableAt = (state: BucketState | null) => {
      if (!state) {
        return nowMs;
      }

      if (state.blockedUntil !== undefined && state.blockedUntil > nowMs) {
        return state.blockedUntil;
      }

      if (
        state.reset !== undefined &&
        state.reset > nowEpochSec &&
        state.remaining === 0
      ) {
        return state.reset * 1000;
      }

      return nowMs;
    };

    const sessionAvailableAt = (
      state: BucketState | null,
      cooldownUntil: number | undefined,
    ) => Math.max(rateLimitAvailableAt(state), cooldownUntil ?? nowMs);

    return withState
      .sort((a, b) => {
        const aAvailableAt = sessionAvailableAt(a.state, a.cooldownUntil);
        const bAvailableAt = sessionAvailableAt(b.state, b.cooldownUntil);
        const aOk = aAvailableAt <= nowMs;
        const bOk = bAvailableAt <= nowMs;
        if (aOk && !bOk) return -1;
        if (!aOk && bOk) return 1;

        if (aOk && bOk) {
          const aRemaining = a.state?.remaining ?? Infinity;
          const bRemaining = b.state?.remaining ?? Infinity;
          return bRemaining - aRemaining;
        }

        return aAvailableAt - bAvailableAt;
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
        const transport = yield* TransportMetadata;
        const endpointCatalog = yield* TwitterEndpointCatalog;
        const transactionIdOverride = yield* Effect.serviceOption(
          TwitterTransactionId,
        );

        const shared = {
          config,
          http,
          ...(Option.isSome(transactionIdOverride)
            ? { transactionIdOverride: transactionIdOverride.value }
            : {}),
        };
        const capsulesRef = yield* Ref.make<ReadonlyArray<SessionCapsule>>(
          [],
        );
        const nextIdRef = yield* Ref.make(0);
        const cooldownsRef = yield* Ref.make<Readonly<Record<number, number>>>({});

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
            yield* endpointCatalog.updateQueryIds(discovered);
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

        const markSessionCooldown = Effect.fn(
          "PooledScraperStrategy.markSessionCooldown",
        )(function* (capsuleId: number, errorTag: string) {
          const cooldownMs = Duration.toMillis(
            config.strategy.sessionFailureCooldown,
          );
          if (cooldownMs <= 0) {
            return;
          }

          const cooldownUntil = (yield* Clock.currentTimeMillis) + cooldownMs;
          yield* Ref.update(cooldownsRef, (current) => ({
            ...current,
            [capsuleId]: cooldownUntil,
          }));
          yield* logDebugDecision("Session cooldown started", {
            cooldown_until: cooldownUntil,
            error_tag: errorTag,
            session_id: capsuleId,
          });
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
              markSessionCooldown(capsuleId, errorTag).pipe(
                Effect.andThen(
                  logDebugDecision("Session failed, rotating to next", {
                    session_id: capsuleId,
                    error_tag: errorTag,
                  }),
                ),
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
            endpointCatalog,
            discovery,
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
            const cooldowns = yield* Ref.get(cooldownsRef);

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
              cooldowns,
            );

            return yield* tryNextCapsule(request, sorted);
          });

        const sessionCount = Ref.get(capsulesRef).pipe(
          Effect.map((cs) => cs.length),
        );

        const snapshot = Ref.get(capsulesRef).pipe(
          Effect.flatMap((cs) =>
            Ref.get(cooldownsRef).pipe(
              Effect.flatMap((cooldowns) =>
            Effect.all(
              cs.map((c) =>
                c.canHandleUserAuth().pipe(
                  Effect.map(
                    (hasUserAuth): SessionSnapshot => ({
                      id: c.id,
                      hasUserAuth,
                      ...(cooldowns[c.id] !== undefined
                        ? { cooldownUntil: cooldowns[c.id] }
                        : {}),
                    }),
                  ),
                ),
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
    ).pipe(Layer.provideMerge(TwitterEndpointCatalog.liveLayer));

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
