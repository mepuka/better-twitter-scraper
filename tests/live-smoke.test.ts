import { spawnSync } from "node:child_process";

import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  CookieManager,
  twitterPublicLiveLayer,
  TwitterPublic,
  TwitterConfig,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";

const runLive = process.env.RUN_LIVE_TWITTER_SMOKE === "1";
const runAuthLive = process.env.RUN_LIVE_TWITTER_AUTH_SMOKE === "1";
const { cookies: serializedCookies, error: serializedCookiesError } =
  loadSerializedCookies();

const userAuthLiveLayer = UserAuth.liveLayer.pipe(
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterConfig.layer),
);

describe("Live guest smoke", () => {
  if (runLive) {
    it("loads a public profile anonymously", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
        const publicApi = yield* TwitterPublic;
        const profile = yield* publicApi.getProfile("nomadic_ua");

        expect(profile.userId).toBeTruthy();
        expect(profile.username?.toLowerCase()).toBe("nomadic_ua");
        }).pipe(Effect.provide(twitterPublicLiveLayer)),
      );
    }, 30000);

    it("loads a public tweet timeline anonymously", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
        const publicApi = yield* TwitterPublic;
        const tweets = yield* Stream.runCollect(
          publicApi.getTweets("XDevelopers", { limit: 3 }),
        );
        const values = tweets;

        expect(values.length).toBeGreaterThan(0);
        expect(values[0]?.id).toBeTruthy();
        }).pipe(Effect.provide(twitterPublicLiveLayer)),
      );
    }, 30000);
  } else {
    it.skip("loads a public profile anonymously", () => {});
    it.skip("loads a public tweet timeline anonymously", () => {});
  }
});

describe("Live authenticated smoke", () => {
  if (runAuthLive && serializedCookiesError) {
    it("fails with a clear error when TWITTER_COOKIES is malformed", () => {
      throw serializedCookiesError;
    });
  } else if (runAuthLive && serializedCookies && serializedCookies.length > 0) {
    it("restores a signed-in session from cookies", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* UserAuth;

          yield* auth.restoreCookies(serializedCookies);

          expect(yield* auth.isLoggedIn()).toBe(true);
        }).pipe(Effect.provide(userAuthLiveLayer)),
      );
    }, 30000);

    it("searches profiles with restored cookies", async () => {
      const result = spawnSync(
        "bun",
        ["scripts/live-auth-smoke.ts"],
        {
          cwd: process.cwd(),
          env: process.env,
          encoding: "utf8",
        },
      );

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const usernames = JSON.parse(stdout) as string[];
      expect(usernames.length).toBeGreaterThan(0);
      expect(usernames[0]).toBeTruthy();
    }, 30000);
  } else {
    it.skip("restores a signed-in session from cookies", () => {});
    it.skip("searches profiles with restored cookies", () => {});
  }
});
