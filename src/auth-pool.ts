import { Effect, Layer, Ref, ServiceMap } from "effect";

import type { SerializedCookie } from "./cookies";
import { AuthenticationError } from "./errors";
import type { RateLimitBucket } from "./request";

/**
 * Rate-limit state tracked per bucket for a pooled session.
 */
export interface SessionRateLimitState {
  readonly remaining: number;
  /** Epoch seconds at which the rate-limit window resets. */
  readonly resetAt: number;
}

/**
 * A minimal view of a pooled session returned by `selectSession`.
 */
export interface SelectedSession {
  readonly id: number;
  readonly cookies: ReadonlyArray<SerializedCookie>;
}

/**
 * A snapshot of a single session's health (for observability).
 */
export interface SessionSnapshot {
  readonly id: number;
  readonly rateLimits: ReadonlyMap<string, SessionRateLimitState>;
}

interface SessionSlot {
  readonly id: number;
  readonly cookies: ReadonlyArray<SerializedCookie>;
  readonly rateLimits: Map<string, SessionRateLimitState>;
}

export class AuthPool extends ServiceMap.Service<
  AuthPool,
  {
    /** Register a new session from serialized browser cookies. */
    readonly addSession: (
      cookies: ReadonlyArray<SerializedCookie>,
    ) => Effect.Effect<void>;

    /**
     * Pick the best session for the given rate-limit bucket.
     *
     * Selection strategy:
     *  1. Sessions with no recorded state for the bucket are preferred (assumed fully available).
     *  2. Among sessions with state, prefer the one with the most `remaining` quota.
     *  3. If all sessions are exhausted (`remaining === 0`), prefer the one whose
     *     `resetAt` is earliest (i.e. will become available soonest).
     *  4. Sessions whose `resetAt` is in the past are treated as available.
     */
    readonly selectSession: (
      bucket: RateLimitBucket,
    ) => Effect.Effect<SelectedSession, AuthenticationError>;

    /** Record rate-limit state observed from a response for a specific session + bucket. */
    readonly noteRateLimit: (
      sessionId: number,
      bucket: RateLimitBucket,
      state: SessionRateLimitState,
    ) => Effect.Effect<void>;

    /** Current number of sessions in the pool. */
    readonly sessionCount: Effect.Effect<number>;

    /** Snapshot of all sessions and their per-bucket rate-limit state. */
    readonly snapshot: Effect.Effect<ReadonlyArray<SessionSnapshot>>;
  }
>()("@better-twitter-scraper/AuthPool") {
  static readonly liveLayer = Layer.effect(
    AuthPool,
    Effect.gen(function* () {
      const sessionsRef = yield* Ref.make<ReadonlyArray<SessionSlot>>([]);
      const nextIdRef = yield* Ref.make(0);

      const addSession = (cookies: ReadonlyArray<SerializedCookie>) =>
        Effect.gen(function* () {
          const id = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1);
          yield* Ref.update(sessionsRef, (sessions) => [
            ...sessions,
            { id, cookies: [...cookies], rateLimits: new Map() },
          ]);
        });

      const selectSession = (bucket: RateLimitBucket) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);

          if (sessions.length === 0) {
            return yield* new AuthenticationError({
              reason: "AuthPool has no sessions. Call addSession() first.",
            });
          }

          const now = Math.floor(Date.now() / 1000);

          // First pass: find a session with no state for this bucket (assumed fully available).
          for (const session of sessions) {
            if (!session.rateLimits.has(bucket)) {
              return { id: session.id, cookies: session.cookies } as SelectedSession;
            }
          }

          // Second pass: find the session with the most remaining quota, or whose
          // reset time has already passed (treat as available).
          let bestAvailable: SessionSlot | undefined;
          let bestRemaining = -1;

          let bestExhausted: SessionSlot | undefined;
          let earliestReset = Infinity;

          for (const session of sessions) {
            const state = session.rateLimits.get(bucket)!;

            if (state.resetAt <= now) {
              // Window has reset -- treat as fully available, pick immediately.
              return { id: session.id, cookies: session.cookies } as SelectedSession;
            }

            if (state.remaining > 0) {
              if (state.remaining > bestRemaining) {
                bestAvailable = session;
                bestRemaining = state.remaining;
              }
            } else {
              // Exhausted -- track earliest reset as fallback.
              if (state.resetAt < earliestReset) {
                bestExhausted = session;
                earliestReset = state.resetAt;
              }
            }
          }

          const chosen = bestAvailable ?? bestExhausted ?? sessions[0]!;
          return { id: chosen.id, cookies: chosen.cookies } as SelectedSession;
        });

      const noteRateLimit = (
        sessionId: number,
        bucket: RateLimitBucket,
        state: SessionRateLimitState,
      ) =>
        Ref.update(sessionsRef, (sessions) =>
          sessions.map((s) => {
            if (s.id !== sessionId) return s;
            const nextLimits = new Map(s.rateLimits);
            nextLimits.set(bucket, state);
            return { ...s, rateLimits: nextLimits };
          }),
        );

      const sessionCount = Ref.get(sessionsRef).pipe(
        Effect.map((s) => s.length),
      );

      const snapshot = Ref.get(sessionsRef).pipe(
        Effect.map((sessions) =>
          sessions.map(
            (s): SessionSnapshot => ({
              id: s.id,
              rateLimits: new Map(s.rateLimits),
            }),
          ),
        ),
      );

      return {
        addSession,
        selectSession,
        noteRateLimit,
        sessionCount,
        snapshot,
      };
    }),
  );
}
