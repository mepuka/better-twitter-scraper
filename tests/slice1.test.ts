import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  CookieManager,
  endpointRegistry,
  GuestAuth,
  httpRequestKey,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
} from "../index";
import type { HttpScript } from "../src/http";
import type { ApiRequest } from "../src/request";
import { profileFixture, tweetsPageOneFixture, tweetsPageTwoFixture } from "./fixtures";

const publicTestLayer = (script: HttpScript) =>
  TwitterPublic.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(GuestAuth.liveLayer),
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.layer),
  );

const strategyTestLayer = (script: HttpScript) =>
  ScraperStrategy.standardLayer.pipe(
    Layer.provideMerge(GuestAuth.liveLayer),
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.layer),
  );

describe("Slice 1 request registry", () => {
  it("builds a typed UserByScreenName request with the right metadata", () => {
    const request = endpointRegistry.userByScreenName("nomadic_ua");

    expect(request.endpointId).toBe("UserByScreenName");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("profileLookup");
    expect(request.url).toContain("UserByScreenName");
    expect(decodeURIComponent(request.url)).toContain("\"screen_name\":\"nomadic_ua\"");
  });
});

describe("Slice 1 public reads", () => {
  it("parses a public profile through the full layer stack", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
      const publicApi = yield* TwitterPublic;
      const profile = yield* publicApi.getProfile("nomadic_ua");

      expect(profile.userId).toBe("106037940");
      expect(profile.username).toBe("nomadic_ua");
      expect(profile.website).toBe("https://nomadic.name");
      expect(profile.avatar).toBe(
        "https://pbs.twimg.com/profile_images/436075027193004032/XlDa2oaz.jpeg",
      );
      }).pipe(
        Effect.provide(
          publicTestLayer({
            [httpRequestKey({
              method: "GET",
              url: endpointRegistry.userByScreenName("nomadic_ua").url,
            })]: [{ status: 200, json: profileFixture }],
          }),
        ),
      ),
    );
  });

  it("streams tweets and stops when a cursor repeats", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
      const publicApi = yield* TwitterPublic;
      const tweets = yield* Stream.runCollect(
        publicApi.getTweets("nomadic_ua", { limit: 10 }),
      );
      const values = tweets;

      expect(values.map((tweet) => tweet.id)).toEqual([
        "tweet-1",
        "tweet-2",
        "tweet-3",
      ]);
      expect(values[0]?.hashtags).toEqual(["slice1"]);
      expect(values[1]?.mentions).toEqual([
        {
          id: "42",
          username: "friend",
          name: "Friendly User",
        },
      ]);
      }).pipe(
        Effect.provide(
          publicTestLayer({
            [httpRequestKey({
              method: "GET",
              url: endpointRegistry.userByScreenName("nomadic_ua").url,
            })]: [{ status: 200, json: profileFixture }],
            [httpRequestKey({
              method: "GET",
              url: endpointRegistry.userTweets("106037940", 10).url,
            })]: [{ status: 200, json: tweetsPageOneFixture }],
            [httpRequestKey({
              method: "GET",
              url: endpointRegistry.userTweets("106037940", 8, "cursor-1").url,
            })]: [{ status: 200, json: tweetsPageTwoFixture }],
          }),
        ),
      ),
    );
  });
});

describe("Slice 1 guest token handling", () => {
  it("refreshes the guest token after the warning header invalidates it", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
      const strategy = yield* ScraperStrategy;
      const guestAuth = yield* GuestAuth;

      const request: ApiRequest<string> = {
        endpointId: "TestDefaultBearer",
        family: "graphql",
        authRequirement: "guest",
        bearerToken: "default",
        rateLimitBucket: "generic",
        method: "GET",
        url: "https://api.x.com/graphql/test/TestDefaultBearer",
        decode: (body) => {
          const value = (body as { value?: unknown }).value;
          if (typeof value !== "string") {
            throw new Error("Missing test value");
          }
          return value;
        },
      };

      const first = yield* (strategy.execute(request) as Effect.Effect<
        string,
        never
      >);
      const second = yield* (strategy.execute(request) as Effect.Effect<
        string,
        never
      >);
      const snapshot = yield* guestAuth.snapshot;

      expect(first).toBe("first");
      expect(second).toBe("second");
      expect(snapshot.token).toBe("guest-2");
      }).pipe(
        Effect.provide(
          strategyTestLayer({
            [httpRequestKey({
              method: "POST",
              url: "https://api.x.com/1.1/guest/activate.json",
            })]: [
              { status: 200, json: { guest_token: "guest-1" } },
              { status: 200, json: { guest_token: "guest-2" } },
            ],
            [httpRequestKey({
              method: "GET",
              url: "https://api.x.com/graphql/test/TestDefaultBearer",
            })]: [
              {
                status: 200,
                headers: { "x-rate-limit-incoming": "0" },
                json: { value: "first" },
              },
              {
                status: 200,
                json: { value: "second" },
              },
            ],
          }),
        ),
      ),
    );
  });
});
