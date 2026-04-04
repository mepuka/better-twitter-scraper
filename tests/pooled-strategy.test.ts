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
        const strategy = yield* ScraperStrategy;

        // First request: session 0 is picked (both are fresh).
        // The response includes headers that mark session 0 as nearly exhausted.
        const r1 = yield* strategy.execute(makeUserRequest());
        expect(JSON.parse(r1)).toEqual({ data: "first" });

        // Second request: session 1 should now be preferred because session 0
        // has remaining=1 while session 1 has no rate limit state (fully available).
        const r2 = yield* strategy.execute(makeUserRequest());
        expect(JSON.parse(r2)).toEqual({ data: "second" });

        // Third request: session 1 now has state too (remaining=50), while
        // session 0 has remaining=1. Session 1 is still preferred.
        const r3 = yield* strategy.execute(makeUserRequest());
        expect(JSON.parse(r3)).toEqual({ data: "third-from-session-1" });
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {
              "GET https://api.x.com/graphql/test/UserTweets": [
                // Request 1: session 0, returns with remaining=1
                {
                  status: 200,
                  json: { data: "first" },
                  headers: {
                    "x-rate-limit-limit": "100",
                    "x-rate-limit-remaining": "1",
                    "x-rate-limit-reset": String(
                      Math.floor(Date.now() / 1000) + 900,
                    ),
                  },
                },
                // Request 2: session 1 (preferred, no state), returns with remaining=50
                {
                  status: 200,
                  json: { data: "second" },
                  headers: {
                    "x-rate-limit-limit": "100",
                    "x-rate-limit-remaining": "50",
                    "x-rate-limit-reset": String(
                      Math.floor(Date.now() / 1000) + 900,
                    ),
                  },
                },
                // Request 3: session 1 still preferred (50 > 1)
                { status: 200, json: { data: "third-from-session-1" } },
              ],
            },
            [userCookies("a"), userCookies("b")],
          ),
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
    "all sessions bot-detected returns the last BotDetectionError, not AuthenticationError",
    () =>
      Effect.gen(function* () {
        const strategy = yield* ScraperStrategy;
        const error = yield* extractError(strategy.execute(makeUserRequest()));
        // Should be BotDetectionError from the last session, not a synthetic AuthenticationError
        expect(error._tag).toBe("BotDetectionError");
      }).pipe(
        Effect.provide(
          makePoolLayer(
            {
              "GET https://api.x.com/graphql/test/UserTweets": [
                { status: 399 }, // session 0 bot-detected
                { status: 399 }, // session 1 bot-detected
              ],
            },
            [userCookies("a"), userCookies("b")],
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
