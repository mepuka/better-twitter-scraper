import { Effect, Layer, Stream } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import {
  CookieManager,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterLists,
  UserAuth,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";
import { ObservabilityCapture } from "../src/observability-capture";
import { httpRequestKey } from "../src/request";
import { parseListTweetsPageResponse } from "../src/parsers";
import {
  listTweetsPageOneFixture,
  listTweetsPageTwoFixture,
} from "./fixtures";

const listTestLayer = (script: HttpScript) =>
  TwitterLists.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.defaultLayer()),
  );

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

describe("List timeline request registry", () => {
  it("builds a typed list timeline request with the right metadata", () => {
    const request = endpointRegistry.listTweets(
      "1736495155002106192",
      250,
      "list-cursor-1",
    );

    expect(request.endpointId).toBe("ListTweets");
    expect(request.family).toBe("graphql");
    expect(request.authRequirement).toBe("user");
    expect(request.bearerToken).toBe("secondary");
    expect(request.rateLimitBucket).toBe("listTweets");
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/ListLatestTweetsTimeline");
    expect(decodeURIComponent(request.url)).toContain(
      "\"listId\":\"1736495155002106192\"",
    );
    expect(decodeURIComponent(request.url)).toContain("\"count\":200");
    expect(decodeURIComponent(request.url)).toContain(
      "\"cursor\":\"list-cursor-1\"",
    );
  });
});

describe("List timeline parser", () => {
  it("parses tweets and cursors from the list timeline wrapper", () => {
    const page = parseListTweetsPageResponse(listTweetsPageOneFixture);

    expect(page.items.map((tweet) => tweet.id)).toEqual([
      "list-tweet-1",
      "list-tweet-2",
    ]);
    expect(page.items[0]?.hashtags).toEqual(["lists"]);
    expect(page.items[1]?.mentions).toEqual([
      {
        id: "55",
        username: "helper",
        name: "Helpful Person",
      },
    ]);
    expect(page.nextCursor).toBe("list-cursor-1");
    expect(page.status).toBe("has_more");
  });

  it("treats missing list instructions as invalid response drift", () => {
    try {
      parseListTweetsPageResponse({
        data: {
          list: {
            tweets_timeline: {
              timeline: {},
            },
          },
        },
      });
      throw new Error("Expected InvalidResponseError");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "ListTweets",
      });
    }
  });
});

describe("List timeline service", () => {
  it.effect("rejects list timeline lookup when no authenticated session is restored", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const lists = yield* TwitterLists;
          return yield* Stream.runCollect(
            lists.getTweets("1736495155002106192", { limit: 1 }),
          );
        }),
      );
      expect(error).toMatchObject({
        _tag: "AuthenticationError",
        reason:
          "ListTweets requires an authenticated session, but session cookies are missing or expired.",
      });
    }).pipe(Effect.provide(listTestLayer({}))),
  );

  it.effect("streams list tweets and stops when a cursor repeats", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const lists = yield* TwitterLists;

      yield* auth.restoreCookies(restoredSessionCookies);
      const tweets = yield* Stream.runCollect(
        lists.getTweets("1736495155002106192", { limit: 10 }),
      );

      expect(tweets.map((tweet) => tweet.id)).toEqual([
        "list-tweet-1",
        "list-tweet-2",
        "list-tweet-3",
      ]);
    }).pipe(
      Effect.provide(
        listTestLayer({
          [httpRequestKey(
            endpointRegistry.listTweets("1736495155002106192", 10),
          )]: [{ status: 200, json: listTweetsPageOneFixture }],
          [httpRequestKey(
            endpointRegistry.listTweets(
              "1736495155002106192",
              8,
              "list-cursor-1",
            ),
          )]: [{ status: 200, json: listTweetsPageTwoFixture }],
        }),
      ),
    ),
  );

  it.live("retries a 429 list timeline response once and records user observability context", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const capture = yield* ObservabilityCapture;
      const lists = yield* TwitterLists;

      yield* auth.restoreCookies(restoredSessionCookies);
      const tweets = yield* Stream.runCollect(
        lists.getTweets("1736495155002106192", { limit: 2 }),
      );
      const logs = yield* capture.logs;
      const spans = yield* capture.spans;

      expect(tweets.map((tweet) => tweet.id)).toEqual([
        "list-tweet-1",
        "list-tweet-2",
      ]);
      expect(
        matchingLogs(logs, "429 retry scheduled").map(
          (entry) => entry.annotations.rate_limit_bucket,
        ),
      ).toContain("listTweets");
      expect(spans).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attributes: expect.objectContaining({
              auth_mode: "user",
              endpoint_id: "ListTweets",
              rate_limit_bucket: "listTweets",
            }),
            name: "ScraperStrategy.execute",
          }),
          expect.objectContaining({
            name: "TwitterLists.fetchTweetsPage",
          }),
        ]),
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          listTestLayer({
            [httpRequestKey(
              endpointRegistry.listTweets("1736495155002106192", 2),
            )]: [
              { status: 429, bodyText: "rate limited" },
              { status: 200, json: listTweetsPageOneFixture },
            ],
          }),
          ObservabilityCapture.layer(),
        ),
      ),
    ),
  );
});
