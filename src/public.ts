import { Effect, Layer, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { InvalidResponseError } from "./errors";
import type { GetTweetsOptions, Profile, Tweet } from "./models";
import { paginateTimeline } from "./pagination";
import { ScraperStrategy, type StrategyError } from "./strategy";

type PublicError = StrategyError | InvalidResponseError;

export class TwitterPublic extends ServiceMap.Service<
  TwitterPublic,
  {
    readonly getProfile: (
      username: string,
    ) => Effect.Effect<Profile, StrategyError>;
    readonly getTweets: (
      username: string,
      options?: GetTweetsOptions,
    ) => Stream.Stream<Tweet, PublicError>;
  }
>()("@better-twitter-scraper/TwitterPublic") {
  static readonly layer = Layer.effect(
    TwitterPublic,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const strategy = yield* ScraperStrategy;

      const getProfile = Effect.fn("TwitterPublic.getProfile")(
        (username: string) =>
          strategy.execute(
            endpointRegistry.userByScreenName(username),
          ),
      );

      const fetchTweetsPage = Effect.fn("TwitterPublic.fetchTweetsPage")(
        (userId: string, count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.userTweets(
              userId,
              Math.min(count, config.timeline.maxPageSize),
              config.timeline.includePromotedContent,
              cursor,
            ),
          ),
      );

      const getTweets = (username: string, options: GetTweetsOptions = {}) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const profile = yield* getProfile(username);
            const userId = profile.userId;
            if (!userId) {
              return yield* new InvalidResponseError({
                endpointId: "UserByScreenName",
                reason: `Profile ${username} did not include a userId`,
              });
            }

            return paginateTimeline({
              remaining: options.limit ?? config.timeline.defaultLimit,
              fetchPage: (cursor, remaining) =>
                fetchTweetsPage(userId, remaining, cursor),
            });
          }),
        );

      return {
        getProfile,
        getTweets,
      };
    }),
  );
}
