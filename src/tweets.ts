import { Effect, Layer, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { InvalidResponseError, TweetNotFoundError } from "./errors";
import type { GetTweetsOptions, TimelinePage, Tweet } from "./models";
import { paginateTimeline } from "./pagination";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { TweetDetailDocument, TweetDetailNode } from "./tweet-detail-model";
import { getSelfThread } from "./tweet-detail-projections";

type TweetDetailError =
  | InvalidResponseError
  | StrategyError
  | TweetNotFoundError;

type TweetTimelineError = StrategyError;

export class TwitterTweets extends ServiceMap.Service<
  TwitterTweets,
  {
    readonly getTweet: (
      id: string,
    ) => Effect.Effect<TweetDetailDocument, TweetDetailError>;
    readonly getTweetAnonymous: (
      id: string,
    ) => Effect.Effect<Tweet, StrategyError | TweetNotFoundError>;
    readonly getThread: (
      id: string,
    ) => Effect.Effect<readonly TweetDetailNode[], TweetDetailError>;
    readonly getTweetsAndReplies: (
      userId: string,
      options?: GetTweetsOptions,
    ) => Stream.Stream<Tweet, TweetTimelineError>;
    readonly getLikedTweets: (
      userId: string,
      options?: GetTweetsOptions,
    ) => Stream.Stream<Tweet, TweetTimelineError>;
    readonly getHomeTimeline: (
      options?: GetTweetsOptions,
    ) => Stream.Stream<Tweet, TweetTimelineError>;
  }
>()("@better-twitter-scraper/TwitterTweets") {
  static readonly layer = Layer.effect(
    TwitterTweets,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const strategy = yield* ScraperStrategy;

      const fetchTweetDetail = Effect.fn("TwitterTweets.fetchTweetDetail")(
        (id: string) =>
          strategy.execute(
            endpointRegistry.tweetDetail(id),
          ),
      );

      const fetchTweetsAndRepliesPage = Effect.fn(
        "TwitterTweets.fetchTweetsAndRepliesPage",
      )((userId: string, count: number, cursor?: string) =>
        strategy.execute(
          endpointRegistry.userTweetsAndReplies(userId, count, cursor),
        ),
      );

      const fetchLikedTweetsPage = Effect.fn("TwitterTweets.fetchLikedTweetsPage")(
        (userId: string, count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.likedTweets(userId, count, cursor),
          ),
      );

      const fetchHomeTimelinePage = Effect.fn("TwitterTweets.fetchHomeTimelinePage")(
        (count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.homeTimeline(count, cursor),
          ),
      );

      const getTweetAnonymous = Effect.fn("TwitterTweets.getTweetAnonymous")(
        (id: string) =>
          strategy.execute(
            endpointRegistry.tweetResultByRestId(id),
          ),
      );

      const getTweet = Effect.fn("TwitterTweets.getTweet")((id: string) =>
        fetchTweetDetail(id),
      );

      const getThread = Effect.fn("TwitterTweets.getThread")((id: string) =>
        getTweet(id).pipe(Effect.map((document) => getSelfThread(document))),
      );

      const streamTweets = (
        userId: string,
        options: GetTweetsOptions,
        fetchPage: (
          userId: string,
          count: number,
          cursor?: string,
        ) => Effect.Effect<TimelinePage<Tweet>, StrategyError>,
      ) =>
        paginateTimeline({
          remaining: options.limit ?? config.timeline.defaultLimit,
          jitterMs: config.pagination.jitterMs,
          fetchPage: (cursor, remaining) =>
            fetchPage(userId, remaining, cursor),
        });

      const getTweetsAndReplies = (
        userId: string,
        options: GetTweetsOptions = {},
      ) =>
        streamTweets(
          userId,
          options,
          fetchTweetsAndRepliesPage,
        );

      const getLikedTweets = (
        userId: string,
        options: GetTweetsOptions = {},
      ) =>
        streamTweets(
          userId,
          options,
          fetchLikedTweetsPage,
        );

      const getHomeTimeline = (options: GetTweetsOptions = {}) =>
        paginateTimeline({
          remaining: options.limit ?? config.timeline.defaultLimit,
          jitterMs: config.pagination.jitterMs,
          fetchPage: (cursor, remaining) =>
            fetchHomeTimelinePage(remaining, cursor),
        });

      return {
        getTweet,
        getTweetAnonymous,
        getThread,
        getTweetsAndReplies,
        getLikedTweets,
        getHomeTimeline,
      };
    }),
  );
}
