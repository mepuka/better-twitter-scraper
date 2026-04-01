import { Effect, Fiber, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { TestClock } from "effect/testing";

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
import { ObservabilityCapture } from "../src/observability-capture";
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

const makeGraphqlAltRequest = (): ApiRequest<string> => ({
  endpointId: "TestGraphqlAlt",
  family: "graphqlAlt",
  authRequirement: "guest",
  bearerToken: "secondary",
  rateLimitBucket: "generic",
  method: "GET",
  url: "https://api.x.com/graphql/test/TestGraphqlAlt",
  responseKind: "json",
  decode: (body) => {
    const value = (body as { value?: unknown }).value;
    if (typeof value !== "string") {
      throw new Error("Missing test value");
    }
    return value;
  },
});

const matchingLogs = (
  logs: readonly {
    readonly annotations: Readonly<Record<string, unknown>>;
    readonly level: string;
    readonly message: unknown;
  }[],
  message: string,
) => logs.filter((entry) => entry.message === message);

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
        expect(tweets[0]?.photos).toEqual([
          expect.objectContaining({
            id: "photo-1",
            url: "https://pbs.twimg.com/media/tweet1-photo.jpg",
            altText: "A photo",
          }),
        ]);
        expect(tweets[0]?.videos).toEqual([
          expect.objectContaining({
            id: "video-1",
            preview: "https://pbs.twimg.com/media/tweet1-video-thumb.jpg",
            url: "https://video.twimg.com/ext_tw_video/tweet1.mp4",
          }),
        ]);
        // Second tweet should have empty media
        expect(tweets[1]?.photos).toEqual([]);
        expect(tweets[1]?.videos).toEqual([]);
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

  it("maps a blank graphqlAlt 404 to BotDetectionError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const strategy = yield* ScraperStrategy;
          return yield* strategy.execute(makeGraphqlAltRequest());
        }).pipe(
          Effect.provide(
            strategyTestLayer({
              [httpRequestKey(makeGraphqlAltRequest())]: [
                { status: 404, bodyText: "" },
              ],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "BotDetectionError",
      endpointId: "TestGraphqlAlt",
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

describe("Slice 3B guest limiter behavior", () => {
  it("waits for the recorded reset time before reusing an exhausted guest bucket", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const publicApi = yield* TwitterPublic;

          const first = yield* publicApi.getProfile("nomadic_ua");
          expect(first.userId).toBe("106037940");

          const secondFiber = yield* publicApi.getProfile("nomadic_ua").pipe(
            Effect.forkScoped,
          );

          yield* TestClock.adjust("1999 millis");
          expect(secondFiber.pollUnsafe()).toBeUndefined();

          yield* TestClock.adjust("1 millis");
          const second = yield* Fiber.join(secondFiber);

          expect(second.userId).toBe("106037940");
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestClock.layer(),
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [
                  {
                    status: 200,
                    headers: {
                      "x-rate-limit-limit": "300",
                      "x-rate-limit-remaining": "0",
                      "x-rate-limit-reset": "2",
                    },
                    json: profileFixture,
                  },
                  {
                    status: 200,
                    json: profileFixture,
                  },
                ],
            }),
          ),
        ),
      ),
    );
  });

  it("retries a 429 guest request after waiting for the reset time", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const publicApi = yield* TwitterPublic;

          const profileFiber = yield* publicApi.getProfile("nomadic_ua").pipe(
            Effect.forkScoped,
          );

          yield* TestClock.adjust("1999 millis");
          expect(profileFiber.pollUnsafe()).toBeUndefined();

          yield* TestClock.adjust("1 millis");
          const profile = yield* Fiber.join(profileFiber);

          expect(profile.userId).toBe("106037940");
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestClock.layer(),
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [
                  {
                    status: 429,
                    headers: {
                      "x-rate-limit-limit": "300",
                      "x-rate-limit-remaining": "0",
                      "x-rate-limit-reset": "2",
                    },
                    bodyText: "try again later",
                  },
                  {
                    status: 200,
                    json: profileFixture,
                  },
                ],
            }),
          ),
        ),
      ),
    );
  });
});

describe("Slice 3C guest observability", () => {
  it("annotates guest warning-header invalidation logs with request context", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const capture = yield* ObservabilityCapture;
        const strategy = yield* ScraperStrategy;

        expect(yield* strategy.execute(makeDefaultBearerRequest())).toBe("first");

        const logs = yield* capture.logs;
        const invalidationLogs = matchingLogs(
          logs,
          "Guest token invalidated from warning header",
        );

        expect(invalidationLogs).toHaveLength(1);
        expect(invalidationLogs[0]?.level).toBe("DEBUG");
        expect(invalidationLogs[0]?.annotations).toMatchObject({
          endpoint_id: "TestDefaultBearer",
          endpoint_family: "graphql",
          rate_limit_bucket: "generic",
          auth_mode: "guest",
          bearer_token: "default",
          transport: "scripted",
          retry_attempt: 0,
          warning_header: "x-rate-limit-incoming",
          warning_value: "0",
        });
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            ObservabilityCapture.layer(),
            strategyTestLayer({
              [guestActivateKey]: [
                { status: 200, json: { guest_token: "guest-1" } },
              ],
              [httpRequestKey(makeDefaultBearerRequest())]: [
                {
                  status: 200,
                  headers: { "x-rate-limit-incoming": "0" },
                  json: { value: "first" },
                },
              ],
            }),
          ),
        ),
      ),
    );
  });

  it("emits exactly one limiter wait log with the expected bucket and delay", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const capture = yield* ObservabilityCapture;
          const publicApi = yield* TwitterPublic;

          yield* publicApi.getProfile("nomadic_ua");

          const secondFiber = yield* publicApi.getProfile("nomadic_ua").pipe(
            Effect.forkScoped,
          );

          yield* TestClock.adjust("1999 millis");
          expect(secondFiber.pollUnsafe()).toBeUndefined();

          yield* TestClock.adjust("1 millis");
          yield* Fiber.join(secondFiber);

          const logs = yield* capture.logs;
          const waitLogs = matchingLogs(logs, "Rate limiter wait begins");

          expect(waitLogs).toHaveLength(1);
          expect(waitLogs[0]?.level).toBe("DEBUG");
          expect(waitLogs[0]?.annotations).toMatchObject({
            endpoint_id: "UserByScreenName",
            endpoint_family: "graphql",
            rate_limit_bucket: "profileLookup",
            auth_mode: "guest",
            bearer_token: "secondary",
            transport: "scripted",
            retry_attempt: 0,
            wait_ms: 2000,
          });
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestClock.layer(),
            ObservabilityCapture.layer(),
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [
                  {
                    status: 200,
                    headers: {
                      "x-rate-limit-limit": "300",
                      "x-rate-limit-remaining": "0",
                      "x-rate-limit-reset": "2",
                    },
                    json: profileFixture,
                  },
                  {
                    status: 200,
                    json: profileFixture,
                  },
                ],
            }),
          ),
        ),
      ),
    );
  });

  it("emits a bot-detection debug log when a guest request is classified", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const capture = yield* ObservabilityCapture;
        const publicApi = yield* TwitterPublic;

        const result = yield* Effect.exit(publicApi.getProfile("nomadic_ua"));
        expect(result._tag).toBe("Failure");

        const logs = yield* capture.logs;
        const botLogs = matchingLogs(logs, "Bot detection classified");

        expect(botLogs).toHaveLength(1);
        expect(botLogs[0]?.annotations).toMatchObject({
          endpoint_id: "UserByScreenName",
          endpoint_family: "graphql",
          rate_limit_bucket: "profileLookup",
          auth_mode: "guest",
          bearer_token: "secondary",
          transport: "scripted",
          retry_attempt: 0,
          status: 399,
          reason: "status_399",
        });
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            ObservabilityCapture.layer(),
            publicTestLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
                [{ status: 399, bodyText: "fingerprint rejected" }],
            }),
          ),
        ),
      ),
    );
  });
});
