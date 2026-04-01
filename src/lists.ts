import { Effect, Layer, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { InvalidResponseError } from "./errors";
import type { GetTweetsOptions, Tweet } from "./models";
import { paginateTimeline } from "./pagination";
import { ScraperStrategy, type StrategyError } from "./strategy";

type ListTimelineError = InvalidResponseError | StrategyError;

export class TwitterLists extends ServiceMap.Service<
  TwitterLists,
  {
    readonly getTweets: (
      listId: string,
      options?: GetTweetsOptions,
    ) => Stream.Stream<Tweet, ListTimelineError>;
  }
>()("@better-twitter-scraper/TwitterLists") {
  static readonly layer = Layer.effect(
    TwitterLists,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const strategy = yield* ScraperStrategy;

      const fetchTweetsPage = Effect.fn("TwitterLists.fetchTweetsPage")(
        (listId: string, count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.listTweets(listId, count, cursor),
          ),
      );

      const getTweets = (listId: string, options: GetTweetsOptions = {}) =>
        paginateTimeline({
          remaining: options.limit ?? config.timeline.defaultLimit,
          fetchPage: (cursor, remaining) =>
            fetchTweetsPage(listId, remaining, cursor),
        });

      return {
        getTweets,
      };
    }),
  );
}
