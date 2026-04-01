import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { AuthPool } from "../src/auth-pool";
import type { SerializedCookie } from "../src/cookies";

const run = <A, E>(effect: Effect.Effect<A, E, AuthPool>) =>
  Effect.runPromise(effect.pipe(Effect.provide(AuthPool.liveLayer)));

const fakeCookies = (label: string): ReadonlyArray<SerializedCookie> => [
  `ct0=${label}-csrf; Domain=twitter.com; Path=/`,
  `auth_token=${label}-auth; Domain=twitter.com; Path=/`,
];

describe("AuthPool", () => {
  it("addSession increments sessionCount", async () => {
    const count = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));
        yield* pool.addSession(fakeCookies("c"));
        return yield* pool.sessionCount;
      }),
    );

    expect(count).toBe(3);
  });

  it("selectSession fails with AuthenticationError when pool is empty", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        return yield* pool.selectSession("generic").pipe(
          Effect.matchEffect({
            onFailure: (e) => Effect.succeed(e),
            onSuccess: () => Effect.succeed(null),
          }),
        );
      }).pipe(Effect.provide(AuthPool.liveLayer)),
    );

    expect(result).not.toBeNull();
    expect(result!._tag).toBe("AuthenticationError");
  });

  it("selectSession returns a session when no rate-limit data exists", async () => {
    const session = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));
        return yield* pool.selectSession("generic");
      }),
    );

    // Should return the first session (id 0) since both are equally available.
    expect(session.id).toBe(0);
    expect(session.cookies.length).toBe(2);
  });

  it("selectSession prefers session with most remaining quota", async () => {
    const session = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));
        yield* pool.addSession(fakeCookies("c"));

        const farFuture = Math.floor(Date.now() / 1000) + 3600;

        // Session 0: 5 remaining
        yield* pool.noteRateLimit(0, "generic", { remaining: 5, resetAt: farFuture });
        // Session 1: 50 remaining (most)
        yield* pool.noteRateLimit(1, "generic", { remaining: 50, resetAt: farFuture });
        // Session 2: 10 remaining
        yield* pool.noteRateLimit(2, "generic", { remaining: 10, resetAt: farFuture });

        return yield* pool.selectSession("generic");
      }),
    );

    expect(session.id).toBe(1);
  });

  it("selectSession skips exhausted sessions", async () => {
    const session = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));

        const farFuture = Math.floor(Date.now() / 1000) + 3600;

        // Session 0: exhausted
        yield* pool.noteRateLimit(0, "generic", { remaining: 0, resetAt: farFuture });
        // Session 1: still has quota
        yield* pool.noteRateLimit(1, "generic", { remaining: 10, resetAt: farFuture });

        return yield* pool.selectSession("generic");
      }),
    );

    expect(session.id).toBe(1);
  });

  it("selectSession considers reset time for fully exhausted pool", async () => {
    const session = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));

        const futureA = Math.floor(Date.now() / 1000) + 7200; // resets in 2h
        const futureB = Math.floor(Date.now() / 1000) + 600; // resets in 10m (earliest)

        // Both exhausted, but session 1 resets sooner.
        yield* pool.noteRateLimit(0, "generic", { remaining: 0, resetAt: futureA });
        yield* pool.noteRateLimit(1, "generic", { remaining: 0, resetAt: futureB });

        return yield* pool.selectSession("generic");
      }),
    );

    expect(session.id).toBe(1);
  });

  it("selectSession treats sessions with past resetAt as available", async () => {
    const session = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));

        const past = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
        const farFuture = Math.floor(Date.now() / 1000) + 3600;

        // Session 0: exhausted, reset in the past (should be treated as available)
        yield* pool.noteRateLimit(0, "generic", { remaining: 0, resetAt: past });
        // Session 1: still has quota
        yield* pool.noteRateLimit(1, "generic", { remaining: 10, resetAt: farFuture });

        return yield* pool.selectSession("generic");
      }),
    );

    // Session 0 is selected because its reset time has passed.
    expect(session.id).toBe(0);
  });

  it("snapshot returns current state for all sessions", async () => {
    const snap = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));

        yield* pool.noteRateLimit(0, "generic", { remaining: 5, resetAt: 1000 });
        yield* pool.noteRateLimit(1, "searchTweets", { remaining: 100, resetAt: 2000 });

        return yield* pool.snapshot;
      }),
    );

    expect(snap.length).toBe(2);
    expect(snap[0]!.id).toBe(0);
    expect(snap[0]!.rateLimits.get("generic")).toEqual({ remaining: 5, resetAt: 1000 });
    expect(snap[1]!.id).toBe(1);
    expect(snap[1]!.rateLimits.get("searchTweets")).toEqual({ remaining: 100, resetAt: 2000 });
  });

  it("selectSession is bucket-scoped — exhaustion in one bucket does not affect another", async () => {
    const session = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));

        const farFuture = Math.floor(Date.now() / 1000) + 3600;

        // Exhaust "generic" but leave "searchTweets" untouched.
        yield* pool.noteRateLimit(0, "generic", { remaining: 0, resetAt: farFuture });

        // Selecting for "searchTweets" should still work (no state = assumed available).
        return yield* pool.selectSession("searchTweets");
      }),
    );

    expect(session.id).toBe(0);
  });

  it("sessions receive monotonically increasing ids", async () => {
    const ids = await run(
      Effect.gen(function* () {
        const pool = yield* AuthPool;
        yield* pool.addSession(fakeCookies("a"));
        yield* pool.addSession(fakeCookies("b"));
        yield* pool.addSession(fakeCookies("c"));

        const snap = yield* pool.snapshot;
        return snap.map((s) => s.id);
      }),
    );

    expect(ids).toEqual([0, 1, 2]);
  });
});
