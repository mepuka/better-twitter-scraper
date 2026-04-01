import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  CookieManager,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterTweets,
  UserAuth,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";
import { ObservabilityCapture } from "../src/observability-capture";
import { parseTweetDetailResponse } from "../src/parsers";
import { httpRequestKey } from "../src/request";
import {
  malformedTweetDetailFixture,
  tweetDetailFixture,
} from "./fixtures";

const restoredSessionCookies = [
  "ct0=csrf-token; Path=/; Domain=x.com",
  "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
] as const;

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

const matchingLogs = (
  logs: readonly {
    readonly annotations: Readonly<Record<string, unknown>>;
    readonly level: string;
    readonly message: unknown;
  }[],
  message: string,
) => logs.filter((entry) => entry.message === message);

describe("Tweet detail request registry", () => {
  it("builds a typed TweetDetail request with the right metadata", () => {
    const request = endpointRegistry.tweetDetail("1665602315745673217");

    expect(request.endpointId).toBe("TweetDetail");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("tweetDetail");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/TweetDetail");
    expect(decodeURIComponent(request.url)).toContain(
      "\"focalTweetId\":\"1665602315745673217\"",
    );
    expect(decodeURIComponent(request.url)).toContain(
      "\"with_rux_injections\":false",
    );
    expect(decodeURIComponent(request.url)).toContain(
      "\"withBirdwatchNotes\":true",
    );
    expect(decodeURIComponent(request.url)).toContain(
      "\"withArticleRichContentState\":true",
    );
  });
});

describe("Tweet detail parser", () => {
  it("builds an acyclic tweet detail document with thread, quote, reply, and retweet relations", () => {
    const document = parseTweetDetailResponse(tweetDetailFixture, "thread-root");

    expect(document.focalTweetId).toBe("thread-root");
    expect(document.tweets.map((tweet) => tweet.id)).toEqual([
      "thread-root",
      "quoted-1",
      "thread-child",
      "reply-1",
      "retweet-1",
      "original-1",
    ]);

    const focalTweet = document.tweets.find((tweet) => tweet.id === "thread-root");
    expect(focalTweet).toMatchObject({
      bookmarkCount: 9,
      conversationId: "thread-root",
      id: "thread-root",
      isEdited: true,
      isPin: true,
      isQuoted: true,
      isReply: false,
      isRetweet: false,
      isSelfThread: true,
      sensitiveContent: false,
      userId: "106037940",
      username: "nomadic_ua",
      views: 100,
    });
    expect(focalTweet?.photos).toHaveLength(1);
    expect(focalTweet?.videos).toHaveLength(1);
    expect(focalTweet?.mentions).toEqual([
      {
        id: "42",
        name: "Friendly User",
        username: "friend",
      },
    ]);
    expect(focalTweet?.place?.fullName).toBe("Austin, TX");
    expect(focalTweet?.html).toContain(
      "https://pbs.twimg.com/media/root-photo.jpg",
    );

    expect(document.relations).toEqual([
      {
        kind: "reply_to",
        sourceTweetId: "reply-1",
        targetTweetId: "thread-child",
      },
      {
        kind: "retweets",
        sourceTweetId: "retweet-1",
        targetTweetId: "original-1",
      },
      {
        kind: "reply_to",
        sourceTweetId: "thread-child",
        targetTweetId: "thread-root",
      },
      {
        kind: "thread_root",
        sourceTweetId: "thread-child",
        targetTweetId: "thread-root",
      },
      {
        kind: "quotes",
        sourceTweetId: "thread-root",
        targetTweetId: "quoted-1",
      },
    ]);

    expect(new Set(document.tweets.map((tweet) => tweet.id)).size).toBe(
      document.tweets.length,
    );
    expect(
      new Set(
        document.relations.map(
          (relation) =>
            `${relation.sourceTweetId}:${relation.kind}:${relation.targetTweetId}`,
        ),
      ).size,
    ).toBe(document.relations.length);
  });

  it("treats missing threaded conversation instructions as invalid response drift", () => {
    try {
      parseTweetDetailResponse(malformedTweetDetailFixture, "thread-root");
      throw new Error("Expected InvalidResponseError");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "TweetDetail",
      });
    }
  });

  it("fails clearly when the focal tweet is absent from the parsed conversation", () => {
    try {
      parseTweetDetailResponse(tweetDetailFixture, "missing-focal-tweet");
      throw new Error("Expected TweetNotFoundError");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "TweetNotFoundError",
        id: "missing-focal-tweet",
      });
    }
  });
});

describe("Tweet detail service", () => {
  it("rejects tweet detail lookup when no authenticated session is restored", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const tweets = yield* TwitterTweets;
          return yield* tweets.getTweet("thread-root");
        }).pipe(Effect.provide(tweetsTestLayer({}))),
      ),
    ).rejects.toMatchObject({
      _tag: "AuthenticationError",
      reason:
        "Authenticated tweet detail lookup requires restored session cookies.",
    });
  });

  it("loads tweet detail through the full authenticated layer stack", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const document = yield* tweets.getTweet("thread-root");

        expect(document.focalTweetId).toBe("thread-root");
        expect(document.tweets.length).toBeGreaterThan(1);
      }).pipe(
        Effect.provide(
          tweetsTestLayer(
            {
              [httpRequestKey(endpointRegistry.tweetDetail("thread-root"))]: [
                { status: 200, json: tweetDetailFixture },
              ],
            },
            {},
          ),
        ),
      ),
    );
  });

  it("retries a 429 tweet detail response once and records user-mode observability context", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const document = yield* tweets.getTweet("thread-root");
        const logs = yield* capture.logs;
        const spans = yield* capture.spans;

        expect(document.focalTweetId).toBe("thread-root");
        expect(
          matchingLogs(logs, "429 retry scheduled").map(
            (entry) => entry.annotations.endpoint_id,
          ),
        ).toContain("TweetDetail");
        expect(spans).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attributes: expect.objectContaining({
                auth_mode: "user",
                endpoint_id: "TweetDetail",
                rate_limit_bucket: "tweetDetail",
              }),
              name: "ScraperStrategy.execute",
            }),
            expect.objectContaining({
              name: "TwitterTweets.getTweet",
            }),
            expect.objectContaining({
              name: "TwitterTweets.fetchTweetDetail",
            }),
          ]),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            tweetsTestLayer({
              [httpRequestKey(endpointRegistry.tweetDetail("thread-root"))]: [
                { status: 429, bodyText: "rate limited" },
                { status: 200, json: tweetDetailFixture },
              ],
            }),
            ObservabilityCapture.layer(),
          ),
        ),
      ),
    );
  });
});
