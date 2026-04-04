import { Effect, Layer, Stream } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
  TwitterSearch,
  TwitterTrends,
  TwitterTweets,
  UserAuth,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";
import { ObservabilityCapture } from "../src/observability-capture";
import { httpRequestKey } from "../src/request";
import {
  likedTweetsDuplicateCursorFixture,
  likedTweetsPageOneFixture,
  likedTweetsPageTwoFixture,
  profileFixture,
  searchTweetsPageOneFixture,
  searchTweetsPageTwoFixture,
  trendsFixture,
  tweetsAndRepliesDuplicateCursorFixture,
  tweetsAndRepliesPageOneFixture,
} from "./fixtures";

const restoredSessionCookies = [
  "ct0=csrf-token; Path=/; Domain=x.com",
  "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
] as const;

const matchingLogs = (
  logs: readonly {
    readonly annotations: Readonly<Record<string, unknown>>;
    readonly level: string;
    readonly message: unknown;
  }[],
  message: string,
) => logs.filter((entry) => entry.message === message);

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

const tweetsTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
) =>
  TwitterTweets.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const trendsTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
) =>
  TwitterTrends.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const mixedExpansionLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
) =>
  Layer.mergeAll(
    TwitterPublic.layer,
    TwitterSearch.layer,
    TwitterTweets.layer,
    TwitterTrends.layer,
  ).pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(GuestAuth.liveLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

describe("Signed-in expansion request registry", () => {
  it("maps tweet search modes to the expected SearchTimeline products", () => {
    const modes = [
      ["top", "Top"],
      ["latest", "Latest"],
      ["photos", "Photos"],
      ["videos", "Videos"],
    ] as const;

    for (const [mode, product] of modes) {
      const request = endpointRegistry.searchTweets("Twitter", 200, mode);

      expect(request.endpointId).toBe("SearchTweets");
      expect(request.family).toBe("graphql");
      expect(request.authRequirement).toBe("user");
      expect(request.bearerToken).toBe("secondary");
      expect(request.rateLimitBucket).toBe("searchTweets");
      expect(request.method).toBe("GET");
      expect(request.url).toContain("/SearchTimeline");
      expect(decodeURIComponent(request.url)).toContain(`"product":"${product}"`);
      expect(decodeURIComponent(request.url)).toContain("\"count\":50");
    }
  });

  it("builds a typed UserTweetsAndReplies request with the right metadata", () => {
    const request = endpointRegistry.userTweetsAndReplies(
      "106037940",
      100,
      "replies-cursor-1",
    );

    expect(request.endpointId).toBe("UserTweetsAndReplies");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("tweetsAndReplies");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/UserTweetsAndReplies");
    expect(decodeURIComponent(request.url)).toContain("\"userId\":\"106037940\"");
    expect(decodeURIComponent(request.url)).toContain("\"count\":40");
    expect(decodeURIComponent(request.url)).toContain(
      "\"includePromotedContent\":false",
    );
    expect(decodeURIComponent(request.url)).toContain("\"withCommunity\":true");
    expect(decodeURIComponent(request.url)).toContain("\"withVoice\":true");
    expect(decodeURIComponent(request.url)).toContain(
      "\"cursor\":\"replies-cursor-1\"",
    );
  });

  it("builds a typed Likes request with the right metadata", () => {
    const request = endpointRegistry.likedTweets("106037940", 400, "likes-cursor-1");

    expect(request.endpointId).toBe("Likes");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("likedTweets");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/Likes");
    expect(decodeURIComponent(request.url)).toContain("\"userId\":\"106037940\"");
    expect(decodeURIComponent(request.url)).toContain("\"count\":200");
    expect(decodeURIComponent(request.url)).toContain(
      "\"includePromotedContent\":false",
    );
    expect(decodeURIComponent(request.url)).toContain(
      "\"withClientEventToken\":false",
    );
    expect(decodeURIComponent(request.url)).toContain(
      "\"withBirdwatchNotes\":false",
    );
    expect(decodeURIComponent(request.url)).toContain("\"withVoice\":true");
  });

  it("builds a typed Trends request with the right metadata", () => {
    const request = endpointRegistry.trends();

    expect(request.endpointId).toBe("Trends");
    expect(request.family).toBe("rest");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("trends");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("https://api.x.com/2/guide.json?");
    expect(request.url).toContain("count=20");
    expect(request.url).toContain("candidate_source=trends");
    expect(request.url).toContain("include_page_configuration=false");
    expect(request.url).toContain("entity_tokens=false");
  });
});

describe("Signed-in tweet search", () => {
  it.effect("rejects tweet search when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const search = yield* TwitterSearch;
          return yield* Stream.runCollect(search.searchTweets("Twitter", { limit: 2 }));
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
      });
    }).pipe(Effect.provide(searchTestLayer({}))),
  );

  it.effect("searches tweets through the authenticated layer stack", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const search = yield* TwitterSearch;

      yield* auth.restoreCookies(restoredSessionCookies);

      const tweets = yield* Stream.runCollect(
        search.searchTweets("Twitter", { limit: 3, mode: "top" }),
      );

      expect(tweets.map((tweet) => tweet.id)).toEqual([
        "search-tweet-1",
        "search-tweet-2",
        "search-tweet-3",
      ]);
      expect(tweets[0]?.views).toBe(111);
    }).pipe(
      Effect.provide(
        searchTestLayer({
          [httpRequestKey(endpointRegistry.searchTweets("Twitter", 3, "top"))]: [
            { status: 200, json: searchTweetsPageOneFixture },
          ],
          [httpRequestKey(
            endpointRegistry.searchTweets(
              "Twitter",
              1,
              "top",
              "search-tweets-cursor-1",
            ),
          )]: [{ status: 200, json: searchTweetsPageTwoFixture }],
        }),
      ),
    ),
  );

  it.live("retries a 429 tweet search response once and records user-mode observability context", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const search = yield* TwitterSearch;

        yield* auth.restoreCookies(restoredSessionCookies);

        const tweets = yield* Stream.runCollect(
          search.searchTweets("Twitter", { limit: 2, mode: "latest" }),
        );
        const logs = yield* capture.logs;
        const spans = yield* capture.spans;

        expect(tweets.length).toBeGreaterThan(0);
        expect(
          matchingLogs(logs, "429 retry scheduled").map(
            (entry) => entry.annotations.rate_limit_bucket,
          ),
        ).toContain("searchTweets");
        expect(spans).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attributes: expect.objectContaining({
                auth_mode: "user",
                endpoint_id: "SearchTweets",
                rate_limit_bucket: "searchTweets",
              }),
              name: "ScraperStrategy.execute",
            }),
            expect.objectContaining({
              name: "TwitterSearch.fetchTweetsPage",
            }),
          ]),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            searchTestLayer({
              [httpRequestKey(
                endpointRegistry.searchTweets("Twitter", 2, "latest"),
              )]: [
                { status: 429, bodyText: "rate limited" },
                { status: 200, json: searchTweetsPageOneFixture },
              ],
            }),
            ObservabilityCapture.layer(),
          ),
        ),
      ),
  );
});

describe("Signed-in tweets and replies", () => {
  it.effect("rejects tweets-and-replies lookup when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const tweets = yield* TwitterTweets;
          return yield* Stream.runCollect(
            tweets.getTweetsAndReplies("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason:
          "UserTweetsAndReplies requires an authenticated session, but session cookies are missing or expired.",
      });
    }).pipe(Effect.provide(tweetsTestLayer({}))),
  );

  it.effect("loads tweets-and-replies pages and truncates to the requested limit", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* Stream.runCollect(
          tweets.getTweetsAndReplies("106037940", { limit: 2 }),
        );

        expect(items.map((tweet) => tweet.id)).toEqual([
          "reply-tweet-1",
          "reply-tweet-2",
        ]);
      }).pipe(
        Effect.provide(
          tweetsTestLayer({
            [httpRequestKey(
              endpointRegistry.userTweetsAndReplies("106037940", 2),
            )]: [{ status: 200, json: tweetsAndRepliesPageOneFixture }],
          }),
        ),
      ),
  );

  it.effect("stops tweets-and-replies pagination on a duplicate cursor", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* Stream.runCollect(
          tweets.getTweetsAndReplies("106037940", { limit: 10 }),
        );

        expect(items.map((tweet) => tweet.id)).toEqual([
          "reply-tweet-1",
          "reply-tweet-2",
          "reply-tweet-4",
        ]);
      }).pipe(
        Effect.provide(
          tweetsTestLayer({
            [httpRequestKey(
              endpointRegistry.userTweetsAndReplies("106037940", 10),
            )]: [{ status: 200, json: tweetsAndRepliesPageOneFixture }],
            [httpRequestKey(
              endpointRegistry.userTweetsAndReplies(
                "106037940",
                8,
                "tweets-and-replies-cursor-1",
              ),
            )]: [{ status: 200, json: tweetsAndRepliesDuplicateCursorFixture }],
          }),
        ),
      ),
  );

  it.effect("treats missing tweets-and-replies instructions as parse drift", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const tweets = yield* TwitterTweets;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            tweets.getTweetsAndReplies("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "UserTweetsAndReplies",
      });
    }).pipe(
      Effect.provide(
        tweetsTestLayer({
          [httpRequestKey(
            endpointRegistry.userTweetsAndReplies("106037940", 2),
          )]: [{ status: 200, json: { data: { user: { result: {} } } } }],
        }),
      ),
    ),
  );

  it.live("retries a 429 tweets-and-replies response once and records user-mode observability context", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* Stream.runCollect(
          tweets.getTweetsAndReplies("106037940", { limit: 2 }),
        );
        const logs = yield* capture.logs;
        const spans = yield* capture.spans;

        expect(items.length).toBeGreaterThan(0);
        expect(
          matchingLogs(logs, "429 retry scheduled").map(
            (entry) => entry.annotations.rate_limit_bucket,
          ),
        ).toContain("tweetsAndReplies");
        expect(spans).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attributes: expect.objectContaining({
                auth_mode: "user",
                endpoint_id: "UserTweetsAndReplies",
                rate_limit_bucket: "tweetsAndReplies",
              }),
              name: "ScraperStrategy.execute",
            }),
            expect.objectContaining({
              name: "TwitterTweets.fetchTweetsAndRepliesPage",
            }),
          ]),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            tweetsTestLayer({
              [httpRequestKey(
                endpointRegistry.userTweetsAndReplies("106037940", 2),
              )]: [
                { status: 429, bodyText: "rate limited" },
                { status: 200, json: tweetsAndRepliesPageOneFixture },
              ],
            }),
            ObservabilityCapture.layer(),
          ),
        ),
      ),
  );
});

describe("Signed-in liked tweets", () => {
  it.effect("rejects liked tweets lookup when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const tweets = yield* TwitterTweets;
          return yield* Stream.runCollect(
            tweets.getLikedTweets("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason: "Likes requires an authenticated session, but session cookies are missing or expired.",
      });
    }).pipe(Effect.provide(tweetsTestLayer({}))),
  );

  it.effect("loads liked tweets pages and truncates to the requested limit", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* Stream.runCollect(
          tweets.getLikedTweets("106037940", { limit: 3 }),
        );

        expect(items.map((tweet) => tweet.id)).toEqual([
          "liked-tweet-1",
          "liked-tweet-2",
          "liked-tweet-3",
        ]);
      }).pipe(
        Effect.provide(
          tweetsTestLayer({
            [httpRequestKey(endpointRegistry.likedTweets("106037940", 3))]: [
              { status: 200, json: likedTweetsPageOneFixture },
            ],
            [httpRequestKey(
              endpointRegistry.likedTweets("106037940", 1, "liked-cursor-1"),
            )]: [{ status: 200, json: likedTweetsPageTwoFixture }],
          }),
        ),
      ),
  );

  it.effect("stops liked-tweets pagination on a duplicate cursor", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* Stream.runCollect(
          tweets.getLikedTweets("106037940", { limit: 10 }),
        );

        expect(items.map((tweet) => tweet.id)).toEqual([
          "liked-tweet-1",
          "liked-tweet-2",
          "liked-tweet-4",
        ]);
      }).pipe(
        Effect.provide(
          tweetsTestLayer({
            [httpRequestKey(endpointRegistry.likedTweets("106037940", 10))]: [
              { status: 200, json: likedTweetsPageOneFixture },
            ],
            [httpRequestKey(
              endpointRegistry.likedTweets("106037940", 8, "liked-cursor-1"),
            )]: [{ status: 200, json: likedTweetsDuplicateCursorFixture }],
          }),
        ),
      ),
  );

  it.effect("treats missing liked-tweets instructions as parse drift", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const tweets = yield* TwitterTweets;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            tweets.getLikedTweets("106037940", { limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "Likes",
      });
    }).pipe(
      Effect.provide(
        tweetsTestLayer({
          [httpRequestKey(endpointRegistry.likedTweets("106037940", 2))]: [
            { status: 200, json: { data: { user: { result: {} } } } },
          ],
        }),
      ),
    ),
  );

  it.live("retries a 429 liked-tweets response once and records user-mode observability context", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* Stream.runCollect(
          tweets.getLikedTweets("106037940", { limit: 2 }),
        );
        const logs = yield* capture.logs;
        const spans = yield* capture.spans;

        expect(items.length).toBeGreaterThan(0);
        expect(
          matchingLogs(logs, "429 retry scheduled").map(
            (entry) => entry.annotations.rate_limit_bucket,
          ),
        ).toContain("likedTweets");
        expect(spans).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attributes: expect.objectContaining({
                auth_mode: "user",
                endpoint_id: "Likes",
                rate_limit_bucket: "likedTweets",
              }),
              name: "ScraperStrategy.execute",
            }),
            expect.objectContaining({
              name: "TwitterTweets.fetchLikedTweetsPage",
            }),
          ]),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            tweetsTestLayer({
              [httpRequestKey(endpointRegistry.likedTweets("106037940", 2))]: [
                { status: 429, bodyText: "rate limited" },
                { status: 200, json: likedTweetsPageOneFixture },
              ],
            }),
            ObservabilityCapture.layer(),
          ),
        ),
      ),
  );
});

describe("Signed-in trends", () => {
  it.effect("rejects trends lookup when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const trends = yield* TwitterTrends;
          return yield* trends.getTrends();
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason: "Authenticated trends lookup requires restored session cookies.",
      });
    }).pipe(Effect.provide(trendsTestLayer({}))),
  );

  it.effect("loads trends through the authenticated layer stack", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const trends = yield* TwitterTrends;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* trends.getTrends();

        expect(items).toEqual(["Effect", "TwitterScraper"]);
      }).pipe(
        Effect.provide(
          trendsTestLayer({
            [httpRequestKey(endpointRegistry.trends())]: [
              { status: 200, json: trendsFixture },
            ],
          }),
        ),
      ),
  );

  it.effect("treats malformed trends payloads as invalid responses", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const trends = yield* TwitterTrends;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* trends.getTrends();
        }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "Trends",
      });
    }).pipe(
      Effect.provide(
        trendsTestLayer({
          [httpRequestKey(endpointRegistry.trends())]: [
            { status: 200, json: { timeline: { instructions: [{}] } } },
          ],
        }),
      ),
    ),
  );

  it.live("retries a 429 trends response once and records user-mode observability context", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const trends = yield* TwitterTrends;

        yield* auth.restoreCookies(restoredSessionCookies);

        const items = yield* trends.getTrends();
        const logs = yield* capture.logs;
        const spans = yield* capture.spans;

        expect(items.length).toBeGreaterThan(0);
        expect(
          matchingLogs(logs, "429 retry scheduled").map(
            (entry) => entry.annotations.rate_limit_bucket,
          ),
        ).toContain("trends");
        expect(spans).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attributes: expect.objectContaining({
                auth_mode: "user",
                endpoint_id: "Trends",
                rate_limit_bucket: "trends",
              }),
              name: "ScraperStrategy.execute",
            }),
            expect.objectContaining({
              name: "TwitterTrends.getTrends",
            }),
          ]),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            trendsTestLayer({
              [httpRequestKey(endpointRegistry.trends())]: [
                { status: 429, bodyText: "rate limited" },
                { status: 200, json: trendsFixture },
              ],
            }),
            ObservabilityCapture.layer(),
          ),
        ),
      ),
  );
});

describe("Signed-in expansion mixed runtime", () => {
  it.effect("keeps guest and authenticated request modes separate in one runtime", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const publicApi = yield* TwitterPublic;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const profile = yield* publicApi.getProfile("nomadic_ua");
        const items = yield* Stream.runCollect(
          tweets.getTweetsAndReplies(profile.userId!, { limit: 2 }),
        );
        const spans = yield* capture.spans;
        const strategyCalls = spans
          .filter((span) => span.name === "ScraperStrategy.execute")
          .map((span) => ({
            authMode: String(span.attributes.auth_mode ?? ""),
            endpointId: String(span.attributes.endpoint_id ?? ""),
          }));

        expect(profile.userId).toBe("106037940");
        expect(items.map((tweet) => tweet.id)).toEqual([
          "reply-tweet-1",
          "reply-tweet-2",
        ]);
        expect(strategyCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              endpointId: "UserByScreenName",
              authMode: "guest",
            }),
            expect.objectContaining({
              endpointId: "UserTweetsAndReplies",
              authMode: "user",
            }),
          ]),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            mixedExpansionLayer({
              [httpRequestKey(endpointRegistry.userByScreenName("nomadic_ua"))]: [
                { status: 200, json: profileFixture },
              ],
              [httpRequestKey(
                endpointRegistry.userTweetsAndReplies("106037940", 2),
              )]: [{ status: 200, json: tweetsAndRepliesPageOneFixture }],
            }),
            ObservabilityCapture.layer(),
          ),
        ),
      ),
  );
});
