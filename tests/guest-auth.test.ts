import { Effect } from "effect";
import * as Cookies from "effect/unstable/http/Cookies";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import { TwitterConfig } from "../src/config";
import { createCookieStore } from "../src/cookies";
import { createGuestAuthInstances } from "../src/guest-auth";

describe("GuestAuth", () => {
  it.effect("coalesces concurrent guest token activation", () =>
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const cookies = yield* createCookieStore();
      let activationCalls = 0;

      const { guestAuth } = yield* createGuestAuthInstances({
        config,
        cookies,
        execute: () =>
          Effect.sync(() => {
            activationCalls += 1;
            return {
              headers: {},
              cookies: Cookies.empty,
              body: { guest_token: "guest-token-123" },
            } as const;
          }),
      });

      const tokens = yield* Effect.all(
        [guestAuth.currentToken(), guestAuth.currentToken()],
        { concurrency: 2 },
      );

      expect(tokens).toEqual(["guest-token-123", "guest-token-123"]);
      expect(activationCalls).toBe(1);
    }).pipe(Effect.provide(TwitterConfig.testLayer())),
  );
});
