import { Effect, Layer, ServiceMap } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError, InvalidResponseError, TweetNotFoundError } from "./errors";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { TweetDetailDocument } from "./tweet-detail-model";
import { UserAuth } from "./user-auth";

type TweetDetailError =
  | AuthenticationError
  | InvalidResponseError
  | StrategyError
  | TweetNotFoundError;

export class TwitterTweets extends ServiceMap.Service<
  TwitterTweets,
  {
    readonly getTweet: (
      id: string,
    ) => Effect.Effect<TweetDetailDocument, TweetDetailError>;
  }
>()("@better-twitter-scraper/TwitterTweets") {
  static readonly layer = Layer.effect(
    TwitterTweets,
    Effect.gen(function* () {
      yield* TwitterConfig;

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

      return {
        getTweet,
      };
    }),
  );
}
