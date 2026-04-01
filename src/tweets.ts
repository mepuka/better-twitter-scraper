import { Effect, Layer, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError, InvalidResponseError, TweetNotFoundError } from "./errors";
import type { GetTweetsOptions, TimelinePage, Tweet } from "./models";
import { paginateTimeline } from "./pagination";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { TweetDetailDocument, TweetDetailNode } from "./tweet-detail-model";
import { getSelfThread } from "./tweet-detail-projections";
import { UserAuth } from "./user-auth";

type TweetDetailError =
  | AuthenticationError
  | InvalidResponseError
  | StrategyError
  | TweetNotFoundError;

type TweetTimelineError = AuthenticationError | StrategyError;

export class TwitterTweets extends ServiceMap.Service<
  TwitterTweets,
  {
    readonly getTweet: (
      id: string,
    ) => Effect.Effect<TweetDetailDocument, TweetDetailError>;
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
  }
>()("@better-twitter-scraper/TwitterTweets") {
  static readonly layer = Layer.effect(
    TwitterTweets,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;

      const auth = yield* UserAuth;
      const strategy = yield* ScraperStrategy;

      const fetchTweetDetail = Effect.fn("TwitterTweets.fetchTweetDetail")(
        (id: string) =>
          strategy.execute(
            endpointRegistry.tweetDetail(id),
          ) as Effect.Effect<TweetDetailDocument, TweetDetailError>,
      );

      const fetchTweetsAndRepliesPage = Effect.fn(
        "TwitterTweets.fetchTweetsAndRepliesPage",
      )((userId: string, count: number, cursor?: string) =>
        strategy.execute(
          endpointRegistry.userTweetsAndReplies(userId, count, cursor),
        ) as Effect.Effect<TimelinePage<Tweet>, StrategyError>,
      );

      const fetchLikedTweetsPage = Effect.fn("TwitterTweets.fetchLikedTweetsPage")(
        (userId: string, count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.likedTweets(userId, count, cursor),
          ) as Effect.Effect<TimelinePage<Tweet>, StrategyError>,
      );

      const getTweet = Effect.fn("TwitterTweets.getTweet")((id: string) =>
        Effect.gen(function* () {
          const loggedIn = yield* auth.isLoggedIn();
          if (!loggedIn) {
            return yield* new AuthenticationError({
              reason:
                "Authenticated tweet detail lookup requires restored session cookies.",
            });
          }

          return yield* fetchTweetDetail(id);
        }),
      );

      const getThread = Effect.fn("TwitterTweets.getThread")((id: string) =>
        getTweet(id).pipe(Effect.map((document) => getSelfThread(document))),
      );

      const streamTweets = (
        userId: string,
        options: GetTweetsOptions,
        authErrorReason: string,
        fetchPage: (
          userId: string,
          count: number,
          cursor?: string,
        ) => Effect.Effect<TimelinePage<Tweet>, StrategyError>,
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const loggedIn = yield* auth.isLoggedIn();
            if (!loggedIn) {
              return yield* new AuthenticationError({
                reason: authErrorReason,
              });
            }

            return paginateTimeline({
              remaining: options.limit ?? config.timeline.defaultLimit,
              fetchPage: (cursor, remaining) =>
                fetchPage(userId, remaining, cursor),
            });
          }),
        );

      const getTweetsAndReplies = (
        userId: string,
        options: GetTweetsOptions = {},
      ) =>
        streamTweets(
          userId,
          options,
          "Authenticated tweets-and-replies lookup requires restored session cookies.",
          fetchTweetsAndRepliesPage,
        );

      const getLikedTweets = (
        userId: string,
        options: GetTweetsOptions = {},
      ) =>
        streamTweets(
          userId,
          options,
          "Authenticated liked tweets lookup requires restored session cookies.",
          fetchLikedTweetsPage,
        );

      return {
        getTweet,
        getThread,
        getTweetsAndReplies,
        getLikedTweets,
      };
    }),
  );
}
