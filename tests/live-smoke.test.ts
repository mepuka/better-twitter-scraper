import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { twitterPublicLiveLayer, TwitterPublic } from "../index";

const runLive = process.env.RUN_LIVE_TWITTER_SMOKE === "1";

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
