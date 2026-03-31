import { spawnSync } from "node:child_process";

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  CookieManager,
  TwitterConfig,
  TwitterHttpClient,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";

const runLive = process.env.RUN_LIVE_TWITTER_SMOKE === "1";
const runAuthLive = process.env.RUN_LIVE_TWITTER_AUTH_SMOKE === "1";
const { cookies: serializedCookies, error: serializedCookiesError } =
  loadSerializedCookies();

const userAuthLiveLayer = UserAuth.liveLayer.pipe(
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer),
  Layer.provideMerge(TwitterConfig.testLayer()),
);

describe("Live guest smoke", () => {
  if (runLive) {
    it("loads a public profile anonymously", async () => {
      const result = spawnSync("bun", ["scripts/live-guest-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly profile: {
          readonly userId?: string;
          readonly username?: string;
        };
      };

      expect(payload.profile.userId).toBeTruthy();
      expect(payload.profile.username?.toLowerCase()).toBe("nomadic_ua");
    }, 30_000);

    it("loads a public tweet timeline anonymously", async () => {
      const result = spawnSync("bun", ["scripts/live-guest-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly tweets: ReadonlyArray<{
          readonly id?: string;
        }>;
      };

      expect(payload.tweets.length).toBeGreaterThan(0);
      expect(payload.tweets[0]?.id).toBeTruthy();
    }, 30_000);
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
    }, 30_000);

    it("searches profiles with restored cookies", async () => {
      const result = spawnSync("bun", ["scripts/live-auth-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

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
    }, 30_000);
  } else {
    it.skip("restores a signed-in session from cookies", () => {});
    it.skip("searches profiles with restored cookies", () => {});
  }
});
