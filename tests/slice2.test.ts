import { Effect, Fiber, Layer, Stream } from "effect";
import { it } from "@effect/vitest";
import { describe, expect, vi } from "vitest";
import { TestClock } from "effect/testing";

import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
  TwitterRelationships,
  TwitterSearch,
  UserAuth,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";
import { ObservabilityCapture } from "../src/observability-capture";
import { httpRequestKey, type ApiRequest } from "../src/request";
import { GuestRequestAuth, UserRequestAuth } from "../src/request-auth";
import * as WebCrypto from "../src/web-crypto";
import { TwitterXpff } from "../src/xpff";
import {
  followersDuplicateCursorFixture,
  followersPageOneFixture,
  followersPageTwoFixture,
  followingPageOneFixture,
  followingPageTwoFixture,
  profileFixture,
  searchProfilesPageOneFixture,
  searchProfilesPageTwoFixture,
  tweetsPageOneFixture,
} from "./fixtures";

const restoredSessionCookies = [
  "ct0=csrf-token; Path=/; Domain=x.com",
  "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
] as const;

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

const matchingLogs = (
  logs: readonly {
    readonly annotations: Readonly<Record<string, unknown>>;
    readonly level: string;
    readonly message: unknown;
  }[],
  message: string,
) => logs.filter((entry) => entry.message === message);

const userAuthTestLayer = (
  initialCookies: Readonly<Record<string, string>> = {},
  options: {
    readonly transactionId?: string;
    readonly xpff?: string;
  } = {},
) =>
  UserAuth.testLayer(options).pipe(
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const searchTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
) =>
  TwitterSearch.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const relationshipsTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
) =>
  TwitterRelationships.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const mixedRuntimeTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
  userAuthOptions: {
    readonly transactionId?: string;
    readonly xpff?: string;
  } = {},
) =>
  Layer.mergeAll(TwitterPublic.layer, TwitterSearch.layer).pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(GuestAuth.liveLayer),
    Layer.provideMerge(UserAuth.testLayer(userAuthOptions)),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const mixedRelationshipsTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
  userAuthOptions: {
    readonly transactionId?: string;
    readonly xpff?: string;
  } = {},
) =>
  Layer.mergeAll(TwitterPublic.layer, TwitterRelationships.layer).pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(GuestAuth.liveLayer),
    Layer.provideMerge(UserAuth.testLayer(userAuthOptions)),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

describe("Slice 2 authenticated session", () => {
  it.effect("restores a logged-in session from serialized cookies", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;

      expect(yield* auth.isLoggedIn()).toBe(false);

      yield* auth.restoreCookies(restoredSessionCookies);

      const serializedCookies = yield* auth.serializeCookies;

      expect(yield* auth.isLoggedIn()).toBe(true);
      expect(serializedCookies).toHaveLength(2);
      expect(serializedCookies.join("\n")).toContain("auth_token=session-token");
      expect(serializedCookies.join("\n")).toContain("ct0=csrf-token");
    }).pipe(Effect.provide(userAuthTestLayer())),
  );

  it.effect("builds authenticated request headers from restored cookies", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const requestAuth = yield* UserRequestAuth;

      yield* auth.restoreCookies(restoredSessionCookies);

      const headers = yield* requestAuth.headersFor(
        endpointRegistry.searchProfiles("Twitter", 2),
      );

      expect(headers.cookie).toContain("ct0=csrf-token");
      expect(headers.cookie).toContain("auth_token=session-token");
      expect(headers["x-csrf-token"]).toBe("csrf-token");
      expect(headers["x-twitter-auth-type"]).toBe("OAuth2Session");
      expect(headers["x-twitter-active-user"]).toBe("yes");
      expect(headers["x-twitter-client-language"]).toBe("en");
      expect(headers["x-client-transaction-id"]).toBe("test-transaction-id");
      expect(headers["x-xp-forwarded-for"]).toBe("test-xpff");
    }).pipe(
      Effect.provide(
        userAuthTestLayer(
          {},
          {
            transactionId: "test-transaction-id",
            xpff: "test-xpff",
          },
        ),
      ),
    ),
  );
});

describe("Slice 4 request registry", () => {
  it("builds a typed Followers request with the right metadata", () => {
    const request = endpointRegistry.followers("106037940", 200, "cursor-1");

    expect(request.endpointId).toBe("Followers");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("followers");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/Followers");
    expect(decodeURIComponent(request.url)).toContain("\"userId\":\"106037940\"");
    expect(decodeURIComponent(request.url)).toContain("\"count\":50");
    expect(decodeURIComponent(request.url)).toContain(
      "\"includePromotedContent\":false",
    );
    expect(decodeURIComponent(request.url)).toContain(
      "\"withGrokTranslatedBio\":false",
    );
    expect(decodeURIComponent(request.url)).toContain("\"cursor\":\"cursor-1\"");
  });

  it("builds a typed Following request with the right metadata", () => {
    const request = endpointRegistry.following("106037940", 20);

    expect(request.endpointId).toBe("Following");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("following");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/Following");
    expect(decodeURIComponent(request.url)).toContain("\"userId\":\"106037940\"");
    expect(decodeURIComponent(request.url)).toContain("\"count\":20");
    expect(decodeURIComponent(request.url)).not.toContain("\"cursor\":");
  });
});

describe("Slice 2 authenticated search", () => {
  it.effect("derives an xpff header when a guest id cookie is present", () =>
    Effect.gen(function* () {
      const xpff = yield* TwitterXpff;
      const headers = yield* xpff.headerFor();

      expect(headers["x-xp-forwarded-for"]).toMatch(/^[0-9a-f]+$/);
      expect(headers["x-xp-forwarded-for"]?.length).toBeGreaterThan(20);
    }).pipe(
      Effect.provide(
        TwitterXpff.liveLayer.pipe(
          Layer.provideMerge(
            CookieManager.testLayer({
              guest_id: "v1%3A123456789012345678",
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("omits an xpff header when no guest id cookie is present", () =>
    Effect.gen(function* () {
      const xpff = yield* TwitterXpff;
      const headers = yield* xpff.headerFor();

      expect(headers).toEqual({});
    }).pipe(
      Effect.provide(
        TwitterXpff.liveLayer.pipe(
          Layer.provideMerge(CookieManager.testLayer()),
        ),
      ),
    ),
  );

  it.effect("maps crypto helper failures to an xpff invalid response error", () => {
    const randomBytesSpy = vi
      .spyOn(WebCrypto, "randomBytes")
      .mockReturnValue(
        Effect.fail(
          new WebCrypto.CryptoOperationError({
            operation: "randomBytes",
            reason: "xpff entropy failed",
          }),
        ),
      );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const xpff = yield* TwitterXpff;
          return yield* xpff.headerFor();
        }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "XpffHeader",
        reason: "xpff entropy failed",
      });
    }).pipe(
      Effect.provide(
        TwitterXpff.liveLayer.pipe(
          Layer.provideMerge(
            CookieManager.testLayer({
              guest_id: "v1%3A123456789012345678",
            }),
          ),
        ),
      ),
      Effect.ensuring(Effect.sync(() => randomBytesSpy.mockRestore())),
    );
  });

  it.effect("rejects profile search when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const search = yield* TwitterSearch;
          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
      });
    }).pipe(Effect.provide(searchTestLayer({}))),
  );

  it.effect("searches profiles through the full layer stack with restored cookies", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const search = yield* TwitterSearch;

      yield* auth.restoreCookies(restoredSessionCookies);

      const profiles = yield* Stream.runCollect(
        search.searchProfiles("Twitter", { limit: 3 }),
      );

      expect(profiles.map((profile) => profile.username)).toEqual([
        "twitterdev",
        "twitterapi",
        "twittereng",
      ]);
      expect(profiles[0]?.website).toBe("https://developer.x.com");
    }).pipe(
      Effect.provide(
        searchTestLayer({
          [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 3))]: [
            { status: 200, json: searchProfilesPageOneFixture },
          ],
          [httpRequestKey(
            endpointRegistry.searchProfiles("Twitter", 1, "search-cursor-1"),
          )]: [{ status: 200, json: searchProfilesPageTwoFixture }],
        }),
      ),
    ),
  );
});

describe("Slice 4 authenticated relationships", () => {
  it.effect("rejects followers when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const relationships = yield* TwitterRelationships;
          return yield* Stream.runCollect(
            relationships.getFollowers("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason: "Authenticated followers lookup requires restored session cookies.",
      });
    }).pipe(Effect.provide(relationshipsTestLayer({}))),
  );

  it.effect("streams followers through the full layer stack with restored cookies", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const relationships = yield* TwitterRelationships;

      yield* auth.restoreCookies(restoredSessionCookies);

      const profiles = yield* Stream.runCollect(
        relationships.getFollowers("106037940", { limit: 3 }),
      );

      expect(profiles.map((profile) => profile.username)).toEqual([
        "follower_one",
        "follower_two",
        "follower_three",
      ]);
    }).pipe(
      Effect.provide(
        relationshipsTestLayer({
          [httpRequestKey(endpointRegistry.followers("106037940", 3))]: [
            { status: 200, json: followersPageOneFixture },
          ],
          [httpRequestKey(
            endpointRegistry.followers("106037940", 1, "followers-cursor-1"),
          )]: [{ status: 200, json: followersPageTwoFixture }],
        }),
      ),
    ),
  );

  it.effect("truncates follower results to the requested limit", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const relationships = yield* TwitterRelationships;

      yield* auth.restoreCookies(restoredSessionCookies);

      const profiles = yield* Stream.runCollect(
        relationships.getFollowers("106037940", { limit: 1 }),
      );

      expect(profiles.map((profile) => profile.username)).toEqual([
        "follower_one",
      ]);
    }).pipe(
      Effect.provide(
        relationshipsTestLayer({
          [httpRequestKey(endpointRegistry.followers("106037940", 1))]: [
            { status: 200, json: followersPageOneFixture },
          ],
        }),
      ),
    ),
  );

  it.effect("stops follower pagination when a cursor repeats", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const relationships = yield* TwitterRelationships;

      yield* auth.restoreCookies(restoredSessionCookies);

      const profiles = yield* Stream.runCollect(
        relationships.getFollowers("106037940", { limit: 10 }),
      );

      expect(profiles.map((profile) => profile.username)).toEqual([
        "follower_one",
        "follower_two",
        "follower_four",
      ]);
    }).pipe(
      Effect.provide(
        relationshipsTestLayer({
          [httpRequestKey(endpointRegistry.followers("106037940", 10))]: [
            { status: 200, json: followersPageOneFixture },
          ],
          [httpRequestKey(
            endpointRegistry.followers("106037940", 8, "followers-cursor-1"),
          )]: [{ status: 200, json: followersDuplicateCursorFixture }],
        }),
      ),
    ),
  );

  it.effect("treats a structurally drifted followers payload as InvalidResponseError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const relationships = yield* TwitterRelationships;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            relationships.getFollowers("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "Followers",
      });
    }).pipe(
      Effect.provide(
        relationshipsTestLayer({
          [httpRequestKey(endpointRegistry.followers("106037940", 2))]: [
            { status: 200, json: { data: { user: { result: {} } } } },
          ],
        }),
      ),
    ),
  );

  it.effect("routes follower 429 retries through the existing limiter and observability path", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const relationships = yield* TwitterRelationships;

        yield* auth.restoreCookies(restoredSessionCookies);

        const followersFiber = yield* Stream.runCollect(
          relationships.getFollowers("106037940", { limit: 2 }),
        ).pipe(Effect.forkScoped);

        yield* TestClock.adjust("999 millis");
        expect(followersFiber.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust("1 millis");
        const profiles = yield* Fiber.join(followersFiber);

        expect(profiles.map((profile) => profile.username)).toEqual([
          "follower_one",
          "follower_two",
        ]);

        const logs = yield* capture.logs;
        const retryLogs = matchingLogs(logs, "429 retry scheduled");

        expect(retryLogs).toHaveLength(1);
        expect(retryLogs[0]?.annotations).toMatchObject({
          endpoint_id: "Followers",
          endpoint_family: "graphql",
          rate_limit_bucket: "followers",
          auth_mode: "user",
          bearer_token: "secondary",
          transport: "scripted",
          retry_attempt: 0,
          status: 429,
        });
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestClock.layer(),
          ObservabilityCapture.layer(),
          relationshipsTestLayer({
            [httpRequestKey(endpointRegistry.followers("106037940", 2))]: [
              { status: 429, bodyText: "too many followers" },
              { status: 200, json: followersPageOneFixture },
            ],
          }),
        ),
      ),
    ),
  );

  it.effect("streams following on the same authenticated path", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const relationships = yield* TwitterRelationships;

      yield* auth.restoreCookies(restoredSessionCookies);

      const profiles = yield* Stream.runCollect(
        relationships.getFollowing("106037940", { limit: 2 }),
      );

      expect(profiles.map((profile) => profile.username)).toEqual([
        "following_one",
        "following_two",
      ]);
    }).pipe(
      Effect.provide(
        relationshipsTestLayer({
          [httpRequestKey(endpointRegistry.following("106037940", 2))]: [
            { status: 200, json: followingPageOneFixture },
          ],
          [httpRequestKey(
            endpointRegistry.following("106037940", 1, "following-cursor-1"),
          )]: [{ status: 200, json: followingPageTwoFixture }],
        }),
      ),
    ),
  );

  it.effect("treats a structurally drifted following payload as InvalidResponseError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const relationships = yield* TwitterRelationships;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            relationships.getFollowing("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "Following",
      });
    }).pipe(
      Effect.provide(
        relationshipsTestLayer({
          [httpRequestKey(endpointRegistry.following("106037940", 2))]: [
            { status: 200, json: { data: { user: { result: {} } } } },
          ],
        }),
      ),
    ),
  );

  it.effect("rejects following when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const relationships = yield* TwitterRelationships;
          return yield* Stream.runCollect(
            relationships.getFollowing("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason: "Authenticated following lookup requires restored session cookies.",
      });
    }).pipe(Effect.provide(relationshipsTestLayer({}))),
  );
});

describe("Slice 3A authenticated failure classification", () => {
  it.effect("maps 401 search failures to AuthenticationError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason:
          "SearchProfiles rejected the restored authenticated session with HTTP 401.",
      });
    }).pipe(
      Effect.provide(
        searchTestLayer({
          [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
            { status: 401, bodyText: "not logged in" },
          ],
        }),
      ),
    ),
  );

  it.live("maps search rate limits to RateLimitError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "RateLimitError",
        endpointId: "SearchProfiles",
        bucket: "searchProfiles",
        status: 429,
        body: "too many searches",
        limit: 50,
        remaining: 0,
        reset: 1712349999,
      });
    }).pipe(
      Effect.provide(
        searchTestLayer({
          [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
            {
              status: 429,
              headers: {
                "x-rate-limit-limit": "50",
                "x-rate-limit-remaining": "0",
                "x-rate-limit-reset": "1712349999",
              },
              bodyText: "too many searches",
            },
            {
              status: 429,
              headers: {
                "x-rate-limit-limit": "50",
                "x-rate-limit-remaining": "0",
                "x-rate-limit-reset": "1712349999",
              },
              bodyText: "too many searches",
            },
          ],
        }),
      ),
    ),
  );

  it.effect("maps a blank search 404 to BotDetectionError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "BotDetectionError",
        endpointId: "SearchProfiles",
        reason: "empty_404",
      });
    }).pipe(
      Effect.provide(
        searchTestLayer({
          [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
            { status: 404, bodyText: "" },
          ],
        }),
      ),
    ),
  );

  it.effect("treats a structurally drifted search payload as InvalidResponseError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "SearchProfiles",
      });
    }).pipe(
      Effect.provide(
        searchTestLayer({
          [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
            { status: 200, json: { data: { search_by_raw_query: {} } } },
          ],
        }),
      ),
    ),
  );
});

describe("Slice 3B authenticated limiter behavior", () => {
  it.effect("uses a deterministic fallback backoff for authenticated 429 retries without a reset header", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const search = yield* TwitterSearch;

        yield* auth.restoreCookies(restoredSessionCookies);

        const searchFiber = yield* Stream.runCollect(
          search.searchProfiles("Twitter", { limit: 2 }),
        ).pipe(Effect.forkScoped);

        yield* TestClock.adjust("999 millis");
        expect(searchFiber.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust("1 millis");
        const profiles = yield* Fiber.join(searchFiber);

        expect(profiles.map((profile) => profile.username)).toEqual([
          "twitterdev",
          "twitterapi",
        ]);
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestClock.layer(),
          searchTestLayer({
            [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]:
              [
                {
                  status: 429,
                  bodyText: "too many searches",
                },
                {
                  status: 200,
                  json: searchProfilesPageOneFixture,
                },
              ],
          }),
        ),
      ),
    ),
  );
});

describe("Slice 3C authenticated observability", () => {
  it.effect("annotates authenticated 429 retry logs with request context", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const search = yield* TwitterSearch;

        yield* auth.restoreCookies(restoredSessionCookies);

        const searchFiber = yield* Stream.runCollect(
          search.searchProfiles("Twitter", { limit: 2 }),
        ).pipe(Effect.forkScoped);

        yield* TestClock.adjust("999 millis");
        expect(searchFiber.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust("1 millis");
        const profiles = yield* Fiber.join(searchFiber);

        expect(profiles.map((profile) => profile.username)).toEqual([
          "twitterdev",
          "twitterapi",
        ]);

        const logs = yield* capture.logs;
        const retryLogs = matchingLogs(logs, "429 retry scheduled");

        expect(retryLogs).toHaveLength(1);
        expect(retryLogs[0]?.level).toBe("DEBUG");
        expect(retryLogs[0]?.annotations).toMatchObject({
          endpoint_id: "SearchProfiles",
          endpoint_family: "graphql",
          rate_limit_bucket: "searchProfiles",
          auth_mode: "user",
          bearer_token: "secondary",
          transport: "scripted",
          retry_attempt: 0,
          status: 429,
        });
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestClock.layer(),
          ObservabilityCapture.layer(),
          searchTestLayer({
            [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]:
              [
                {
                  status: 429,
                  bodyText: "too many searches",
                },
                {
                  status: 200,
                  json: searchProfilesPageOneFixture,
                },
              ],
          }),
        ),
      ),
    ),
  );
});

describe("Mixed runtime auth composition", () => {
  it.effect("resolves a guest profile lookup and authenticated followers in one runtime", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const capture = yield* ObservabilityCapture;
      const publicApi = yield* TwitterPublic;
      const relationships = yield* TwitterRelationships;

      yield* auth.restoreCookies(restoredSessionCookies);

      const profile = yield* publicApi.getProfile("nomadic_ua");
      const userId = profile.userId;

      expect(userId).toBe("106037940");

      const followers = yield* Stream.runCollect(
        relationships.getFollowers(userId!, { limit: 2 }),
      );

      expect(followers.map((item) => item.username)).toEqual([
        "follower_one",
        "follower_two",
      ]);

      const spans = yield* capture.spans;
      const strategySpans = spans.filter(
        (span) => span.name === "ScraperStrategy.execute",
      );

      expect(strategySpans).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attributes: expect.objectContaining({
              endpoint_id: "UserByScreenName",
              auth_mode: "guest",
            }),
          }),
          expect.objectContaining({
            attributes: expect.objectContaining({
              endpoint_id: "Followers",
              auth_mode: "user",
            }),
          }),
        ]),
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ObservabilityCapture.layer(),
          mixedRelationshipsTestLayer({
            [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
              [{ status: 200, json: profileFixture }],
            [httpRequestKey(endpointRegistry.followers("106037940", 2))]: [
              { status: 200, json: followersPageOneFixture },
            ],
          }),
        ),
      ),
    ),
  );

  it.effect("hosts guest public reads and authenticated search in one runtime", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const capture = yield* ObservabilityCapture;
      const publicApi = yield* TwitterPublic;
      const search = yield* TwitterSearch;

      yield* auth.restoreCookies(restoredSessionCookies);

      const profile = yield* publicApi.getProfile("nomadic_ua");
      const tweets = yield* Stream.runCollect(
        publicApi.getTweets("nomadic_ua", { limit: 2 }),
      );
      const profiles = yield* Stream.runCollect(
        search.searchProfiles("Twitter", { limit: 2 }),
      );

      expect(profile.username).toBe("nomadic_ua");
      expect(tweets.map((tweet) => tweet.id)).toEqual(["tweet-1", "tweet-2"]);
      expect(profiles.map((item) => item.username)).toEqual([
        "twitterdev",
        "twitterapi",
      ]);

      const spans = yield* capture.spans;
      const strategySpans = spans.filter(
        (span) => span.name === "ScraperStrategy.execute",
      );

      expect(strategySpans).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attributes: expect.objectContaining({
              endpoint_id: "UserByScreenName",
              auth_mode: "guest",
            }),
          }),
          expect.objectContaining({
            attributes: expect.objectContaining({
              endpoint_id: "UserTweets",
              auth_mode: "guest",
            }),
          }),
          expect.objectContaining({
            attributes: expect.objectContaining({
              endpoint_id: "SearchProfiles",
              auth_mode: "user",
            }),
          }),
        ]),
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ObservabilityCapture.layer(),
          mixedRuntimeTestLayer({
            [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]:
              [
                { status: 200, json: profileFixture },
                { status: 200, json: profileFixture },
              ],
            [httpRequestKey(endpointRegistry.userTweets("106037940", 2, false))]:
              [{ status: 200, json: tweetsPageOneFixture }],
            [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
              { status: 200, json: searchProfilesPageOneFixture },
            ],
          }),
        ),
      ),
    ),
  );

  it.effect("keeps signed-in-only headers off guest requests in a mixed runtime", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const guestRequestAuth = yield* GuestRequestAuth;
      const userRequestAuth = yield* UserRequestAuth;

      yield* auth.restoreCookies(restoredSessionCookies);

      const guestHeaders = yield* guestRequestAuth.headersFor(
        endpointRegistry.userByScreenName("nomadic_ua"),
      );
      const userHeaders = yield* userRequestAuth.headersFor(
        endpointRegistry.searchProfiles("Twitter", 2),
      );

      expect(guestHeaders.cookie).toContain("auth_token=session-token");
      expect(guestHeaders["x-csrf-token"]).toBe("csrf-token");
      expect(guestHeaders["x-twitter-auth-type"]).toBeUndefined();
      expect(guestHeaders["x-twitter-active-user"]).toBeUndefined();
      expect(guestHeaders["x-client-transaction-id"]).toBeUndefined();
      expect(guestHeaders["x-xp-forwarded-for"]).toBeUndefined();

      expect(userHeaders["x-twitter-auth-type"]).toBe("OAuth2Session");
      expect(userHeaders["x-twitter-active-user"]).toBe("yes");
      expect(userHeaders["x-client-transaction-id"]).toBe("test-transaction-id");
      expect(userHeaders["x-xp-forwarded-for"]).toBe("test-xpff");
    }).pipe(
      Effect.provide(
        mixedRuntimeTestLayer(
          {},
          {},
          {
            transactionId: "test-transaction-id",
            xpff: "test-xpff",
          },
        ),
      ),
    ),
  );

  it.effect("guest token invalidation does not clear the restored user session", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const search = yield* TwitterSearch;
      const strategy = yield* ScraperStrategy;

      yield* auth.restoreCookies(restoredSessionCookies);

      expect(yield* auth.isLoggedIn()).toBe(true);
      expect(yield* strategy.execute(makeDefaultBearerRequest())).toBe("guest-ok");
      expect(yield* auth.isLoggedIn()).toBe(true);

      const profiles = yield* Stream.runCollect(
        search.searchProfiles("Twitter", { limit: 2 }),
      );

      expect(profiles.map((profile) => profile.username)).toEqual([
        "twitterdev",
        "twitterapi",
      ]);
    }).pipe(
      Effect.provide(
        mixedRuntimeTestLayer({
          [guestActivateKey]: [
            { status: 200, json: { guest_token: "guest-1" } },
            { status: 200, json: { guest_token: "guest-2" } },
          ],
          [httpRequestKey(makeDefaultBearerRequest())]: [
            {
              status: 200,
              headers: { "x-rate-limit-incoming": "0" },
              json: { value: "guest-ok" },
            },
          ],
          [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
            { status: 200, json: searchProfilesPageOneFixture },
          ],
        }),
      ),
    ),
  );
});
