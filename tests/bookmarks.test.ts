import { Effect, Layer, Stream } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

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
import {
  parseBookmarksPageResponse,
  parseBookmarkMutationResponse,
} from "../src/parsers";
import { httpRequestKey } from "../src/request";
import {
  bookmarkMutationSuccessFixture,
  bookmarksPageOneFixture,
  bookmarksPageTwoFixture,
} from "./fixtures";

const restoredSessionCookies = [
  "ct0=csrf-token; Path=/; Domain=x.com",
  "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
] as const;

const bookmarksTestLayer = (
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

describe("Bookmarks endpoint registry", () => {
  it("builds a typed Bookmarks request with the right metadata", () => {
    const request = endpointRegistry.bookmarks(200, "bm-cursor-1");

    expect(request.endpointId).toBe("Bookmarks");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("bookmarks");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/BookmarkSearchTimeline");
    expect(decodeURIComponent(request.url)).toContain("\"count\":200");
    expect(decodeURIComponent(request.url)).toContain("\"rawQuery\":");
    expect(decodeURIComponent(request.url)).toContain(
      "content_disclosure_indicator_enabled",
    );
  });

  it("clamps bookmark count to 200", () => {
    const request = endpointRegistry.bookmarks(500);
    expect(decodeURIComponent(request.url)).toContain("\"count\":200");
  });

  it("builds a typed DeleteBookmark request with the right metadata", () => {
    const request = endpointRegistry.removeBookmark("123456789");

    expect(request.endpointId).toBe("DeleteBookmark");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.method).toBe("POST");
    expect(request.url).toContain("/DeleteBookmark");
  });
});

describe("Bookmarks parser", () => {
  it("parses a bookmarks timeline page with tweets and cursor", () => {
    const page = parseBookmarksPageResponse(bookmarksPageOneFixture);

    expect(page.items.map((tweet) => tweet.id)).toEqual([
      "bookmark-tweet-1",
      "bookmark-tweet-2",
    ]);
    expect(page.nextCursor).toBe("bookmark-cursor-1");
    expect(page.status).toBe("has_more");
  });

  it("parses a terminal bookmarks page without cursor", () => {
    const page = parseBookmarksPageResponse(bookmarksPageTwoFixture);

    expect(page.items.map((tweet) => tweet.id)).toEqual([
      "bookmark-tweet-3",
    ]);
    expect(page.status).toBe("at_end");
  });

  it("ignores tombstoned quoted and retweeted tweets when parsing bookmarks", () => {
    const fixture = structuredClone(bookmarksPageOneFixture) as any;
    const entries =
      fixture.data.search_by_raw_query.bookmarks_search_timeline.timeline.instructions[0]
        .entries;
    const quotedParent = entries[0].content.itemContent.tweet_results.result;
    const retweetParent = entries[1].content.itemContent.tweet_results.result;

    quotedParent.quoted_status_result = {
      result: {
        __typename: "TweetTombstone",
        rest_id: "deleted-quoted-tweet",
      },
    };
    quotedParent.legacy.quoted_status_id_str = "deleted-quoted-tweet";

    retweetParent.legacy.retweeted_status_result = {
      result: {
        __typename: "TweetTombstone",
        rest_id: "deleted-retweeted-tweet",
      },
    };
    retweetParent.legacy.retweeted_status_id_str = "deleted-retweeted-tweet";

    const page = parseBookmarksPageResponse(fixture);
    const [firstTweet, secondTweet] = page.items;

    if (!firstTweet || !secondTweet) {
      throw new Error("Fixture drifted unexpectedly.");
    }

    expect(page.items.map((tweet) => tweet.id)).toEqual([
      "bookmark-tweet-1",
      "bookmark-tweet-2",
    ]);
    expect(firstTweet).toMatchObject({
      id: "bookmark-tweet-1",
      isQuoted: true,
      quotedTweetId: "deleted-quoted-tweet",
    });
    expect(secondTweet).toMatchObject({
      id: "bookmark-tweet-2",
      isRetweet: true,
      retweetedTweetId: "deleted-retweeted-tweet",
    });
    expect(firstTweet.quotedTweet).toBeUndefined();
    expect(secondTweet.retweetedTweet).toBeUndefined();
  });

  it("parses a bookmark mutation response without error", () => {
    expect(() =>
      parseBookmarkMutationResponse(bookmarkMutationSuccessFixture),
    ).not.toThrow();
  });

  it("throws on a GraphQL error in the mutation response", () => {
    try {
      parseBookmarkMutationResponse({
        errors: [{ message: "Could not delete bookmark" }],
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "DeleteBookmark",
        reason: "Could not delete bookmark",
      });
    }
  });

  it("throws on an unexpected mutation response shape", () => {
    try {
      parseBookmarkMutationResponse({ data: {} });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "DeleteBookmark",
        reason: "Unexpected DeleteBookmark response shape",
      });
    }
  });
});

describe("Bookmarks service", () => {
  it.effect("rejects bookmarks lookup when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const tweets = yield* TwitterTweets;
          return yield* Stream.runCollect(
            tweets.getBookmarks({ limit: 2 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason: "Bookmarks requires an authenticated session, but session cookies are missing or expired.",
      });
    }).pipe(Effect.provide(bookmarksTestLayer({}))),
  );

  it.effect("loads bookmarks pages and truncates to the requested limit", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const tweets = yield* TwitterTweets;

      yield* auth.restoreCookies(restoredSessionCookies);

      const items = yield* Stream.runCollect(
        tweets.getBookmarks({ limit: 3 }),
      );

      expect(items.map((tweet) => tweet.id)).toEqual([
        "bookmark-tweet-1",
        "bookmark-tweet-2",
        "bookmark-tweet-3",
      ]);
    }).pipe(
      Effect.provide(
        bookmarksTestLayer({
          [httpRequestKey(endpointRegistry.bookmarks(3))]: [
            { status: 200, json: bookmarksPageOneFixture },
          ],
          [httpRequestKey(
            endpointRegistry.bookmarks(1, "bookmark-cursor-1"),
          )]: [{ status: 200, json: bookmarksPageTwoFixture }],
        }),
      ),
    ),
  );

  it.effect("removes a bookmark via the DeleteBookmark mutation", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const tweets = yield* TwitterTweets;

      yield* auth.restoreCookies(restoredSessionCookies);

      yield* tweets.removeBookmark("123456789");
    }).pipe(
      Effect.provide(
        bookmarksTestLayer({
          [httpRequestKey(endpointRegistry.removeBookmark("123456789"))]: [
            { status: 200, json: bookmarkMutationSuccessFixture },
          ],
        }),
      ),
    ),
  );
});
