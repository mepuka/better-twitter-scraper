import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  CookieManager,
  getConversationProjection,
  getConversationRoot,
  getDirectReplies,
  getFocalTweet,
  getParentTweet,
  getQuotedTweet,
  getReplyChain,
  getReplyTree,
  getRetweetedTweet,
  getSelfThread,
  ScraperStrategy,
  TweetDetailDocument,
  TweetDetailNode,
  TweetRelation,
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

const detailNode = (
  input: Partial<ConstructorParameters<typeof TweetDetailNode>[0]> & {
    readonly id: string;
  },
) =>
  new TweetDetailNode({
    ...input,
    hashtags: [],
    id: input.id,
    isEdited: false,
    isPin: false,
    isQuoted: false,
    isReply: false,
    isRetweet: false,
    isSelfThread: false,
    mentions: [],
    photos: [],
    resolution: "full",
    sensitiveContent: false,
    urls: [],
    versions: [input.id],
    videos: [],
  });

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

describe("Tweet detail projections", () => {
  it("marks placeholder relation targets as reference nodes and upgrades duplicate observations to full", () => {
    const referenceFixture = structuredClone(tweetDetailFixture) as any;
    const entries =
      referenceFixture.data.threaded_conversation_with_injections_v2.instructions[0]
        ?.entries ?? [];
    const focalResult =
      entries[0]?.content?.itemContent?.tweet_results?.result;

    if (!focalResult?.legacy) {
      throw new Error("Fixture drifted unexpectedly.");
    }

    focalResult.legacy.quoted_status_id_str = "quoted-reference";
    delete (focalResult as Record<string, unknown>).quoted_status_result;

    referenceFixture.data.threaded_conversation_with_injections_v2.instructions[0] = {
      entries: entries.filter(
        (entry: any) =>
          entry.content?.itemContent?.tweet_results?.result?.rest_id !== "quoted-1",
      ),
    };

    const referenceDocument = parseTweetDetailResponse(
      referenceFixture,
      "thread-root",
    );
    const upgradedDocument = parseTweetDetailResponse(tweetDetailFixture, "thread-root");

    expect(
      referenceDocument.tweets.find((tweet) => tweet.id === "quoted-reference"),
    ).toMatchObject({
      id: "quoted-reference",
      resolution: "reference",
    });
    expect(
      upgradedDocument.tweets.find((tweet) => tweet.id === "quoted-1"),
    ).toMatchObject({
      id: "quoted-1",
      resolution: "full",
    });
    expect(getQuotedTweet(referenceDocument)).toMatchObject({
      id: "quoted-reference",
      resolution: "reference",
    });
  });

  it("projects focal tweet, relations, self thread, and reply tree without mutating the document", () => {
    const document = parseTweetDetailResponse(tweetDetailFixture, "thread-root");
    const beforeTweetIds = document.tweets.map((tweet) => tweet.id);

    const focalTweet = getFocalTweet(document);
    const parentTweet = getParentTweet(document, "reply-1");
    const quotedTweet = getQuotedTweet(document);
    const retweetedTweet = getRetweetedTweet(document, "retweet-1");
    const selfThread = getSelfThread(document);
    const rootReplies = getDirectReplies(document, "thread-root");
    const childReplies = getDirectReplies(document, "thread-child");
    const replyTree = getReplyTree(document);

    expect(focalTweet?.id).toBe("thread-root");
    expect(parentTweet?.id).toBe("thread-child");
    expect(quotedTweet?.id).toBe("quoted-1");
    expect(retweetedTweet?.id).toBe("original-1");
    expect(selfThread.map((tweet) => tweet.id)).toEqual([
      "thread-root",
      "thread-child",
    ]);
    expect(rootReplies.map((tweet) => tweet.id)).toEqual(["thread-child"]);
    expect(childReplies.map((tweet) => tweet.id)).toEqual(["reply-1"]);
    expect(replyTree).toMatchObject({
      tweet: { id: "thread-root" },
      replies: [
        {
          tweet: { id: "thread-child" },
          replies: [{ tweet: { id: "reply-1" }, replies: [] }],
        },
      ],
    });
    expect(document.tweets.map((tweet) => tweet.id)).toEqual(beforeTweetIds);
  });

  it("projects reply chains, conversation roots, and bundled conversation context", () => {
    const document = parseTweetDetailResponse(tweetDetailFixture, "thread-root");

    const replyChain = getReplyChain(document, "reply-1");
    const conversationRoot = getConversationRoot(document, "reply-1");
    const projection = getConversationProjection(document, "thread-child");

    expect(replyChain.map((tweet) => tweet.id)).toEqual([
      "thread-root",
      "thread-child",
      "reply-1",
    ]);
    expect(conversationRoot?.id).toBe("thread-root");
    expect(getConversationRoot(document, "retweet-1")?.id).toBe("retweet-1");
    expect(getReplyChain(document, "retweet-1").map((tweet) => tweet.id)).toEqual([
      "retweet-1",
    ]);
    expect(projection).toMatchObject({
      conversationRoot: { id: "thread-root" },
      directReplies: [{ id: "reply-1" }],
      parentTweet: { id: "thread-root" },
      replyChain: [{ id: "thread-root" }, { id: "thread-child" }],
      replyTree: {
        tweet: { id: "thread-child" },
        replies: [{ tweet: { id: "reply-1" }, replies: [] }],
      },
      selfThread: [{ id: "thread-root" }, { id: "thread-child" }],
      tweet: { id: "thread-child" },
    });
    expect(getConversationProjection(document, "missing-tweet")).toBeUndefined();
  });

  it("keeps direct replies and reply trees in canonical document order", () => {
    const document = new TweetDetailDocument({
      focalTweetId: "root",
      relations: [
        new TweetRelation({
          kind: "reply_to",
          sourceTweetId: "reply-b",
          targetTweetId: "root",
        }),
        new TweetRelation({
          kind: "reply_to",
          sourceTweetId: "reply-a",
          targetTweetId: "root",
        }),
        new TweetRelation({
          kind: "reply_to",
          sourceTweetId: "reply-a-child",
          targetTweetId: "reply-a",
        }),
      ],
      tweets: [
        detailNode({ id: "root" }),
        detailNode({ id: "reply-b", isReply: true }),
        detailNode({ id: "reply-a", isReply: true }),
        detailNode({ id: "reply-a-child", isReply: true }),
      ],
    });

    expect(getDirectReplies(document).map((tweet) => tweet.id)).toEqual([
      "reply-b",
      "reply-a",
    ]);
    expect(getReplyTree(document)).toMatchObject({
      tweet: { id: "root" },
      replies: [
        { tweet: { id: "reply-b" }, replies: [] },
        {
          tweet: { id: "reply-a" },
          replies: [{ tweet: { id: "reply-a-child" }, replies: [] }],
        },
      ],
    });
  });

  it("avoids cycles and duplicate nodes when projecting malformed reply graphs", () => {
    const document = new TweetDetailDocument({
      focalTweetId: "root",
      relations: [
        new TweetRelation({
          kind: "reply_to",
          sourceTweetId: "child",
          targetTweetId: "root",
        }),
        new TweetRelation({
          kind: "reply_to",
          sourceTweetId: "root",
          targetTweetId: "child",
        }),
      ],
      tweets: [
        detailNode({ id: "root", isReply: true }),
        detailNode({ id: "child", isReply: true }),
      ],
    });

    expect(getReplyTree(document)).toMatchObject({
      tweet: { id: "root" },
      replies: [{ tweet: { id: "child" }, replies: [] }],
    });
    expect(getReplyChain(document).map((tweet) => tweet.id)).toEqual([
      "child",
      "root",
    ]);
    expect(new Set(getReplyChain(document).map((tweet) => tweet.id)).size).toBe(
      getReplyChain(document).length,
    );
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

  it("rejects thread lookup when no authenticated session is restored", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const tweets = yield* TwitterTweets;
          return yield* tweets.getThread("thread-root");
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

  it("projects the same self thread through getThread as the pure helper path", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const document = yield* tweets.getTweet("thread-root");
        const thread = yield* tweets.getThread("thread-root");

        expect(thread.map((tweet) => tweet.id)).toEqual(
          getSelfThread(document).map((tweet) => tweet.id),
        );
      }).pipe(
        Effect.provide(
          tweetsTestLayer(
            {
              [httpRequestKey(endpointRegistry.tweetDetail("thread-root"))]: [
                { status: 200, json: tweetDetailFixture },
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

  it("retries a 429 thread lookup once and keeps tweet detail observability context underneath", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const capture = yield* ObservabilityCapture;
        const tweets = yield* TwitterTweets;

        yield* auth.restoreCookies(restoredSessionCookies);

        const thread = yield* tweets.getThread("thread-root");
        const logs = yield* capture.logs;
        const spans = yield* capture.spans;

        expect(thread.map((tweet) => tweet.id)).toEqual([
          "thread-root",
          "thread-child",
        ]);
        expect(
          matchingLogs(logs, "429 retry scheduled").map(
            (entry) => entry.annotations.rate_limit_bucket,
          ),
        ).toContain("tweetDetail");
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
              name: "TwitterTweets.getThread",
            }),
            expect.objectContaining({
              name: "TwitterTweets.getTweet",
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
