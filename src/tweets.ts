import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError, InvalidResponseError, TweetNotFoundError } from "./errors";
import type { GetTweetsOptions, TimelinePage, Tweet } from "./models";
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

interface TweetStreamState {
  readonly cursor?: string;
  readonly remaining: number;
  readonly seenCursors: ReadonlySet<string>;
  readonly userId: string;
}

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
          (strategy.execute(
            endpointRegistry.tweetDetail(id),
          ) as Effect.Effect<TweetDetailDocument, TweetDetailError>).pipe(
            Effect.withSpan("TwitterTweets.fetchTweetDetail"),
          ),
      );

      const fetchTweetsAndRepliesPage = Effect.fn(
        "TwitterTweets.fetchTweetsAndRepliesPage",
      )((userId: string, count: number, cursor?: string) =>
        (strategy.execute(
          endpointRegistry.userTweetsAndReplies(userId, count, cursor),
        ) as Effect.Effect<TimelinePage<Tweet>, StrategyError>).pipe(
          Effect.withSpan("TwitterTweets.fetchTweetsAndRepliesPage"),
        ),
      );

      const fetchLikedTweetsPage = Effect.fn("TwitterTweets.fetchLikedTweetsPage")(
        (userId: string, count: number, cursor?: string) =>
          (strategy.execute(
            endpointRegistry.likedTweets(userId, count, cursor),
          ) as Effect.Effect<TimelinePage<Tweet>, StrategyError>).pipe(
            Effect.withSpan("TwitterTweets.fetchLikedTweetsPage"),
          ),
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
        }).pipe(Effect.withSpan("TwitterTweets.getTweet")),
      );

      const getThread = Effect.fn("TwitterTweets.getThread")((id: string) =>
        getTweet(id).pipe(
          Effect.map((document) => getSelfThread(document)),
          Effect.withSpan("TwitterTweets.getThread"),
        ),
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

            const initialState: TweetStreamState = {
              userId,
              remaining: options.limit ?? config.timeline.defaultLimit,
              seenCursors: new Set<string>(),
            };

            return Stream.paginate<TweetStreamState, Tweet, TweetTimelineError>(
              initialState,
              (state) => {
                if (state.remaining <= 0) {
                  return Effect.succeed([
                    [],
                    Option.none<TweetStreamState>(),
                  ] as const);
                }

                return Effect.gen(function* () {
                  const page = yield* fetchPage(
                    state.userId,
                    state.remaining,
                    state.cursor,
                  );
                  const items = page.items.slice(0, state.remaining);
                  const duplicateCursor =
                    page.nextCursor !== undefined &&
                    state.seenCursors.has(page.nextCursor);
                  const remaining = state.remaining - items.length;

                  const nextState =
                    items.length === 0 ||
                    !page.nextCursor ||
                    page.status === "at_end" ||
                    duplicateCursor ||
                    remaining <= 0
                      ? Option.none<TweetStreamState>()
                      : Option.some({
                          userId: state.userId,
                          cursor: page.nextCursor,
                          remaining,
                          seenCursors: new Set(state.seenCursors).add(
                            page.nextCursor,
                          ),
                        });

                  return [items, nextState] as const;
                });
              },
            );
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
