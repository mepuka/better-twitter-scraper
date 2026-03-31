import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";
import { httpRequestKey, type ApiRequest } from "../src/request";
import {
  profileFixture,
  tweetsPageOneFixture,
  tweetsPageTwoFixture,
} from "./fixtures";

const publicTestLayer = (script: HttpScript) =>
  TwitterPublic.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(GuestAuth.liveLayer),
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const strategyTestLayer = (script: HttpScript) =>
  ScraperStrategy.standardLayer.pipe(
    Layer.provideMerge(GuestAuth.liveLayer),
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const guestActivateKey = httpRequestKey({
  method: "POST",
  url: "https://api.x.com/1.1/guest/activate.json",
});

const makeDefaultBearerRequest = (): ApiRequest<string> => ({
  endpointId: "TestDefaultBearer",
  family: "graphql",
  authRequirement: "guest",
  bearerToken: "default",
  rateLimitBucket: "generic",
  method: "GET",
  url: "https://api.x.com/graphql/test/TestDefaultBearer",
  responseKind: "json",
  decode: (body) => {
    const value = (body as { value?: unknown }).value;
    if (typeof value !== "string") {
      throw new Error("Missing test value");
    }
    return value;
  },
});

describe("Slice 1 request registry", () => {
  it("builds a typed UserByScreenName request with the right metadata", () => {
    const request = endpointRegistry.userByScreenName("nomadic_ua");

    expect(request.endpointId).toBe("UserByScreenName");
    expect(request.method).toBe("GET");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("profileLookup");
    expect(request.url).toContain("UserByScreenName");
    expect(decodeURIComponent(request.url)).toContain(
      "\"screen_name\":\"nomadic_ua\"",
    );
  });

  it("builds a typed guest activation request", () => {
    const request = endpointRegistry.guestActivate(
      "https://api.x.com/1.1/guest/activate.json",
    );

    expect(request.endpointId).toBe("GuestActivate");
    expect(request.family).toBe("activation");
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({
      _tag: "form",
      value: {},
    });
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
            [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]: [
              { status: 200, json: profileFixture },
            ],
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

        expect(tweets.map((tweet) => tweet.id)).toEqual([
          "tweet-1",
          "tweet-2",
          "tweet-3",
        ]);
        expect(tweets[0]?.hashtags).toEqual(["slice1"]);
        expect(tweets[1]?.mentions).toEqual([
          {
            id: "42",
            username: "friend",
            name: "Friendly User",
          },
        ]);
      }).pipe(
        Effect.provide(
          publicTestLayer({
            [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]: [
              { status: 200, json: profileFixture },
            ],
            [httpRequestKey(endpointRegistry.userTweets("106037940", 10, false))]:
              [{ status: 200, json: tweetsPageOneFixture }],
            [httpRequestKey(
              endpointRegistry.userTweets("106037940", 8, false, "cursor-1"),
            )]: [{ status: 200, json: tweetsPageTwoFixture }],
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
        const request = makeDefaultBearerRequest();

        const first = yield* strategy.execute(request);
        const second = yield* strategy.execute(request);
        const snapshot = yield* guestAuth.snapshot;

        expect(first).toBe("first");
        expect(second).toBe("second");
        expect(snapshot.token).toBe("guest-2");
      }).pipe(
        Effect.provide(
          strategyTestLayer({
            [guestActivateKey]: [
              { status: 200, json: { guest_token: "guest-1" } },
              { status: 200, json: { guest_token: "guest-2" } },
            ],
            [httpRequestKey(makeDefaultBearerRequest())]: [
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

  it("retries a rejected default-bearer guest request once and then fails as GuestTokenError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const strategy = yield* ScraperStrategy;
          return yield* strategy.execute(makeDefaultBearerRequest());
        }).pipe(
          Effect.provide(
            strategyTestLayer({
              [guestActivateKey]: [
                { status: 200, json: { guest_token: "guest-1" } },
                { status: 200, json: { guest_token: "guest-2" } },
              ],
              [httpRequestKey(makeDefaultBearerRequest())]: [
                { status: 401, bodyText: "expired guest token" },
                { status: 401, bodyText: "expired guest token" },
              ],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "GuestTokenError",
      reason:
        "TestDefaultBearer rejected the guest token with HTTP 401.",
    });
  });
});

describe("Slice 3A guest failure classification", () => {
  it("maps a 429 profile lookup to RateLimitError with parsed metadata", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const publicApi = yield* TwitterPublic;
          return yield* publicApi.getProfile("nomadic_ua");
        }).pipe(
          Effect.provide(
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [
                  {
                    status: 429,
                    headers: {
                      "x-rate-limit-limit": "300",
                      "x-rate-limit-remaining": "0",
                      "x-rate-limit-reset": "1712345678",
                    },
                    bodyText: "slow down",
                  },
                ],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RateLimitError",
      endpointId: "UserByScreenName",
      bucket: "profileLookup",
      status: 429,
      body: "slow down",
      limit: 300,
      remaining: 0,
      reset: 1712345678,
    });
  });

  it("maps an HTTP 399 profile lookup to BotDetectionError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const publicApi = yield* TwitterPublic;
          return yield* publicApi.getProfile("nomadic_ua");
        }).pipe(
          Effect.provide(
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [{ status: 399, bodyText: "fingerprint rejected" }],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "BotDetectionError",
      endpointId: "UserByScreenName",
      status: 399,
      body: "fingerprint rejected",
      reason: "status_399",
    });
  });

  it("maps a blank GraphQL 404 to BotDetectionError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const publicApi = yield* TwitterPublic;
          return yield* publicApi.getProfile("nomadic_ua");
        }).pipe(
          Effect.provide(
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [{ status: 404, bodyText: "" }],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "BotDetectionError",
      endpointId: "UserByScreenName",
      status: 404,
      body: "",
      reason: "empty_404",
    });
  });

  it("maps malformed JSON responses to InvalidResponseError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const publicApi = yield* TwitterPublic;
          return yield* publicApi.getProfile("nomadic_ua");
        }).pipe(
          Effect.provide(
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [{ status: 200, bodyText: "{" }],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "InvalidResponseError",
      endpointId: "UserByScreenName",
    });
  });

  it("treats a drifted timeline payload as InvalidResponseError instead of an empty page", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const publicApi = yield* TwitterPublic;
          return yield* Stream.runCollect(
            publicApi.getTweets("nomadic_ua", { limit: 3 }),
          );
        }).pipe(
          Effect.provide(
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [{ status: 200, json: profileFixture }],
              [httpRequestKey(endpointRegistry.userTweets("106037940", 3, false))]:
                [{ status: 200, json: { data: { user: {} } } }],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "InvalidResponseError",
      endpointId: "UserTweets",
    });
  });
});
