import { Effect } from "effect";
import * as Cookies from "effect/unstable/http/Cookies";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import type { SerializedCookie } from "../src/cookies";
import { RateLimitError } from "../src/errors";
import { createSessionCapsule } from "../src/session-capsule";
import { TwitterConfig, type TwitterConfigShape } from "../src/config";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userCookies: ReadonlyArray<SerializedCookie> = [
  { name: "ct0", value: "csrf-token-123", domain: ".x.com" },
  { name: "auth_token", value: "auth-123", domain: ".x.com" },
  { name: "guest_id", value: "guest-456", domain: ".x.com" },
];

const guestOnlyCookies: ReadonlyArray<SerializedCookie> = [
  { name: "guest_id", value: "guest-456", domain: ".x.com" },
];

const stubShared = (config: TwitterConfigShape) => ({
  config,
  transactionId: {
    headerFor: () => Effect.succeed({} as Readonly<Record<string, string>>),
  },
  http: {
    execute: () =>
      Effect.succeed({
        headers: {} as Readonly<Record<string, string>>,
        cookies: Cookies.empty,
        body: "",
      }),
  },
});

const makeCapsule = (
  id: number,
  cookies: ReadonlyArray<SerializedCookie>,
) =>
  Effect.gen(function* () {
    const config = yield* TwitterConfig;
    return yield* createSessionCapsule(id, cookies, stubShared(config));
  });

const testConfigLayer = TwitterConfig.defaultLayer();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionCapsule", () => {
  it.effect(
    "creates capsule from serialized cookies — canHandleUserAuth returns true",
    () =>
      Effect.gen(function* () {
        const capsule = yield* makeCapsule(0, userCookies);

        expect(capsule.id).toBe(0);
        expect(yield* capsule.canHandleUserAuth()).toBe(true);
      }).pipe(Effect.provide(testConfigLayer)),
  );

  it.effect(
    "canHandleUserAuth returns false without auth cookies",
    () =>
      Effect.gen(function* () {
        const capsule = yield* makeCapsule(1, guestOnlyCookies);

        expect(capsule.id).toBe(1);
        expect(yield* capsule.canHandleUserAuth()).toBe(false);
      }).pipe(Effect.provide(testConfigLayer)),
  );

  it.effect("capsule has independent cookie state", () =>
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const shared = stubShared(config);
      const capsuleA = yield* createSessionCapsule(0, userCookies, shared);
      const capsuleB = yield* createSessionCapsule(1, userCookies, shared);

      // Mutate capsule A's cookies
      yield* capsuleA.cookies.put("ct0", "mutated-csrf");

      // Capsule B should still have the original value
      const ct0A = yield* capsuleA.cookies.get("ct0");
      const ct0B = yield* capsuleB.cookies.get("ct0");

      expect(ct0A).toBe("mutated-csrf");
      expect(ct0B).toBe("csrf-token-123");
    }).pipe(Effect.provide(testConfigLayer)),
  );

  it.effect("capsule has independent rate limiter", () =>
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const shared = stubShared(config);
      const capsuleA = yield* createSessionCapsule(0, userCookies, shared);
      const capsuleB = yield* createSessionCapsule(1, userCookies, shared);

      // Note a rate limit on capsule A
      yield* capsuleA.rateLimiter.noteRateLimit(
        new RateLimitError({
          endpointId: "Test",
          bucket: "generic",
          status: 429,
          body: "",
          limit: 100,
          remaining: 0,
          reset: Math.floor(Date.now() / 1000) + 3600,
        }),
      );

      // Capsule A should have the rate limit state
      const snapshotA = yield* capsuleA.rateLimiter.snapshot("generic");
      expect(snapshotA).not.toBeNull();
      expect(snapshotA!.remaining).toBe(0);

      // Capsule B should have no rate limit state
      const snapshotB = yield* capsuleB.rateLimiter.snapshot("generic");
      expect(snapshotB).toBeNull();
    }).pipe(Effect.provide(testConfigLayer)),
  );
});
