import { Effect, Layer, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import type {
  GetProfilesOptions,
  Profile,
  SearchTweetsOptions,
  TimelinePage,
  Tweet,
} from "./models";
import { paginateTimeline } from "./pagination";
import { ScraperStrategy, type StrategyError } from "./strategy";

type SearchError = StrategyError;

export class TwitterSearch extends ServiceMap.Service<
  TwitterSearch,
  {
    readonly searchProfiles: (
      query: string,
      options?: GetProfilesOptions,
    ) => Stream.Stream<Profile, SearchError>;
    readonly searchTweets: (
      query: string,
      options?: SearchTweetsOptions,
    ) => Stream.Stream<Tweet, SearchError>;
  }
>()("@better-twitter-scraper/TwitterSearch") {
  static readonly layer = Layer.effect(
    TwitterSearch,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const strategy = yield* ScraperStrategy;

      const fetchProfilesPage = Effect.fn("TwitterSearch.fetchProfilesPage")(
        (query: string, count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.searchProfiles(
              query,
              Math.min(count, config.search.maxPageSize),
              cursor,
            ),
          ),
      );

      const fetchTweetsPage = Effect.fn("TwitterSearch.fetchTweetsPage")(
        (query: string, count: number, mode: SearchTweetsOptions["mode"], cursor?: string) =>
          strategy.execute(
            endpointRegistry.searchTweets(
              query,
              Math.min(count, config.search.maxPageSize),
              mode ?? "top",
              cursor,
            ),
          ),
      );

      const streamSearch = <T>(
        query: string,
        options: {
          readonly limit?: number;
        },
        fetchPage: (
          query: string,
          count: number,
          cursor?: string,
        ) => Effect.Effect<TimelinePage<T>, StrategyError>,
      ) =>
        paginateTimeline({
          remaining: options.limit ?? config.search.defaultLimit,
          jitterMs: config.pagination.jitterMs,
          fetchPage: (cursor, remaining) =>
            fetchPage(query, remaining, cursor),
        });

      const searchProfiles = (
        query: string,
        options: GetProfilesOptions = {},
      ) =>
        streamSearch(query, options, (searchQuery, count, cursor) =>
          fetchProfilesPage(searchQuery, count, cursor),
        );

      const searchTweets = (
        query: string,
        options: SearchTweetsOptions = {},
      ) =>
        streamSearch(query, options, (searchQuery, count, cursor) =>
          fetchTweetsPage(searchQuery, count, options.mode, cursor),
        );

      return { searchProfiles, searchTweets };
    }),
  );
}
