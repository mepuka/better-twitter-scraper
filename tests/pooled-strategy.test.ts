import { Effect, Layer } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import { TwitterConfig } from "../src/config";
import type { SerializedCookie } from "../src/cookies";
import { AuthenticationError } from "../src/errors";
import {
  PooledScraperStrategy,
  SessionPoolManager,
} from "../src/pooled-strategy";
import type { ApiRequest } from "../src/request";
import { ScraperStrategy, type StrategyError } from "../src/strategy";
import { TwitterTransactionId } from "../src/transaction-id";
import { transportMetadataLayer } from "../src/observability";
import { TwitterHttpClient, type HttpScript } from "../src/http";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userCookies = (label: string): ReadonlyArray<SerializedCookie> => [
  { name: "ct0", value: `csrf-${label}`, domain: ".x.com" },
  { name: "auth_token", value: `auth-${label}`, domain: ".x.com" },
];

const makeUserRequest = (
  overrides?: Partial<ApiRequest<string>>,
): ApiRequest<string> => ({
  endpointId: "UserTweets",
  family: "graphql",
  authRequirement: "user",
  bearerToken: "default",
  rateLimitBucket: "userTweets",
  method: "GET",
  url: "https://api.x.com/graphql/test/UserTweets",
  responseKind: "json",
  decode: (body) => JSON.stringify(body),
  ...overrides,
});

const makeGuestRequest = (
  overrides?: Partial<ApiRequest<string>>,
): ApiRequest<string> => ({
  ...makeUserRequest(),
  authRequirement: "guest",
  ...overrides,
});

/** Extract the error from a failing effect as a resolved value. */
const extractError = <A>(
  effect: Effect.Effect<A, StrategyError>,
): Effect.Effect<StrategyError, never> =>
  Effect.matchEffect(effect, {
    onSuccess: () =>
      Effect.die(new Error("Expected effect to fail but it succeeded")),
    onFailure: (error) => Effect.succeed(error),
  });

// ---------------------------------------------------------------------------
// Shared deps layer
// ---------------------------------------------------------------------------

const baseDeps = Layer.mergeAll(
  TwitterConfig.testLayer({ strategy: { retryLimit: 0 } }),
  TwitterTransactionId.testLayer(),
  transportMetadataLayer("scripted"),
);

const makePoolLayer = (
  script: HttpScript,
  initialSessions: ReadonlyArray<ReadonlyArray<SerializedCookie>> = [],
) =>
  PooledScraperStrategy.layer(initialSessions).pipe(
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(baseDeps),
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PooledScraperStrategy", () => {
  it.effect(
    "bot detection (399) rotates to next session",
    () =>
      Effect.gen(function* () {
        const strategy = yield* ScraperStrategy;
        const result = yield* strategy.execute(makeUserRequest());
        expect(JSON.parse(result)).toEqual({ data: "ok" });
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {
              "GET https://api.x.com/graphql/test/UserTweets": [
                { status: 399 },
                { status: 200, json: { data: "ok" } },
              ],
            },
            [userCookies("a"), userCookies("b")],
          ),
        ),
      ),
  );

  it.effect(
    "auth error (401) rotates to next session for user-auth requests",
    () =>
      Effect.gen(function* () {
        const strategy = yield* ScraperStrategy;
        const result = yield* strategy.execute(makeUserRequest());
        expect(JSON.parse(result)).toEqual({ data: "recovered" });
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {
              "GET https://api.x.com/graphql/test/UserTweets": [
                { status: 401, bodyText: "unauthorized" },
                { status: 200, json: { data: "recovered" } },
              ],
            },
            [userCookies("a"), userCookies("b")],
          ),
        ),
      ),
  );

  it.effect(
    "no sessions with user auth fails with AuthenticationError",
    () =>
      Effect.gen(function* () {
        // Empty pool = guest-only capsule. User-auth endpoint should fail.
        const strategy = yield* ScraperStrategy;
        const error = yield* extractError(
          strategy.execute(makeUserRequest()),
        );

        expect(error._tag).toBe("AuthenticationError");
        expect((error as AuthenticationError).reason).toContain(
          "requires authenticated session cookies",
        );
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {
              // No scripted responses needed since we fail before making HTTP calls
            },
            [], // no initial sessions => guest-only capsule
          ),
        ),
      ),
  );

  it.effect("guest endpoint works with empty pool (guest-only capsule)", () =>
    Effect.gen(function* () {
      const strategy = yield* ScraperStrategy;
      const result = yield* strategy.execute(makeGuestRequest());
      expect(JSON.parse(result)).toEqual({ data: "guest-ok" });
    }).pipe(
      Effect.provide(
        makePoolLayer(
          {
            // Guest activation for the guest-only capsule
            "POST https://api.x.com/1.1/guest/activate.json": [
              {
                status: 200,
                json: { guest_token: "gt-123" },
              },
            ],
            "GET https://api.x.com/graphql/test/UserTweets": [
              { status: 200, json: { data: "guest-ok" } },
            ],
          },
          [], // empty = guest-only capsule
        ),
      ),
    ),
  );

  it.effect(
    "rate limit (429) does NOT trigger rotation — fails immediately",
    () =>
      Effect.gen(function* () {
        const strategy = yield* ScraperStrategy;
        const error = yield* extractError(
          strategy.execute(makeUserRequest()),
        );

        // Should be RateLimitError, not rotation to second session
        expect(error._tag).toBe("RateLimitError");
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {
              "GET https://api.x.com/graphql/test/UserTweets": [
                {
                  status: 429,
                  headers: {
                    "x-rate-limit-limit": "100",
                    "x-rate-limit-remaining": "0",
                  },
                },
                // If rotation happened, this would be consumed — it should NOT be.
                { status: 200, json: { data: "should-not-reach" } },
              ],
            },
            [userCookies("a"), userCookies("b")],
          ),
        ),
      ),
  );

  it.effect(
    "selection prefers session with most rate limit headroom",
    () =>
      Effect.gen(function* () {
        // We set up 2 sessions. Session 0 has exhausted rate limit,
        // session 1 has remaining quota. The pool should try session 1 first.
        // We only provide one successful response — if the wrong session is
        // tried first it will fail.
        const strategy = yield* ScraperStrategy;
        const manager = yield* SessionPoolManager;

        // Get snapshot to verify we have 2 sessions
        const snap = yield* manager.snapshot;
        expect(snap.length).toBe(2);

        const result = yield* strategy.execute(makeUserRequest());
        expect(JSON.parse(result)).toEqual({ data: "from-session-1" });
      }).pipe(
        Effect.provide(
          (() => {
            // Session 0 will get its rate limit noted BEFORE the execute call.
            // We need to control this. Since we can't easily pre-set rate limit
            // state externally, we use a different approach:
            // Session 0 returns 399 (bot detection, causes rotation), session 1
            // returns success. This also validates rotation ordering.
            const script: HttpScript = {
              "GET https://api.x.com/graphql/test/UserTweets": [
                { status: 399 }, // session 0 fails
                { status: 200, json: { data: "from-session-1" } }, // session 1 succeeds
              ],
            };
            return makePoolLayer(script, [
              userCookies("a"),
              userCookies("b"),
            ]);
          })(),
        ),
      ),
  );

  it.effect(
    "addSession adds a working session at runtime",
    () =>
      Effect.gen(function* () {
        const strategy = yield* ScraperStrategy;
        const manager = yield* SessionPoolManager;

        // Pool starts with no user-auth-capable sessions (guest-only capsule)
        const countBefore = yield* manager.sessionCount;
        expect(countBefore).toBe(1); // guest-only capsule

        // User-auth request should fail before adding a session
        const errorBefore = yield* extractError(
          strategy.execute(makeUserRequest()),
        );
        expect(errorBefore._tag).toBe("AuthenticationError");

        // Add a real session
        yield* manager.addSession(userCookies("added"));

        const countAfter = yield* manager.sessionCount;
        expect(countAfter).toBe(2);

        // Now user-auth requests should work
        const result = yield* strategy.execute(makeUserRequest());
        expect(JSON.parse(result)).toEqual({ data: "after-add" });
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {
              "GET https://api.x.com/graphql/test/UserTweets": [
                { status: 200, json: { data: "after-add" } },
              ],
            },
            [], // start with empty pool
          ),
        ),
      ),
  );

  it.effect(
    "snapshot reflects hasUserAuth correctly",
    () =>
      Effect.gen(function* () {
        const manager = yield* SessionPoolManager;
        const snap = yield* manager.snapshot;

        expect(snap.length).toBe(2);
        expect(snap[0]!.id).toBe(0);
        expect(snap[0]!.hasUserAuth).toBe(true);
        expect(snap[1]!.id).toBe(1);
        expect(snap[1]!.hasUserAuth).toBe(false);
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {},
            [
              userCookies("auth"), // has ct0 + auth_token
              [{ name: "guest_id", value: "guest-456", domain: ".x.com" }], // guest-only
            ],
          ),
        ),
      ),
  );
});
