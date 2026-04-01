import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError } from "./errors";
import type {
  GetProfilesOptions,
  Profile,
  SearchTweetsOptions,
  TimelinePage,
  Tweet,
} from "./models";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { UserAuth } from "./user-auth";

type SearchError = AuthenticationError | StrategyError;

interface SearchState {
  readonly query: string;
  readonly cursor?: string;
  readonly remaining: number;
  readonly seenCursors: ReadonlySet<string>;
}

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
      const auth = yield* UserAuth;
      const strategy = yield* ScraperStrategy;

      const fetchProfilesPage = Effect.fn("TwitterSearch.fetchProfilesPage")(
        (query: string, count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.searchProfiles(
              query,
              Math.min(count, config.search.maxPageSize),
              cursor,
            ),
          ) as Effect.Effect<TimelinePage<Profile>, StrategyError>,
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
          ) as Effect.Effect<TimelinePage<Tweet>, StrategyError>,
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
        Stream.unwrap(
          Effect.gen(function* () {
            const loggedIn = yield* auth.isLoggedIn();
            if (!loggedIn) {
              return yield* new AuthenticationError({
                reason: "Authenticated search requires restored session cookies.",
              });
            }

            const initialState: SearchState = {
              query,
              remaining: options.limit ?? config.search.defaultLimit,
              seenCursors: new Set<string>(),
            };

            return Stream.paginate<SearchState, T, SearchError>(
              initialState,
              (state) => {
                if (state.remaining <= 0) {
                  return Effect.succeed([
                    [],
                    Option.none<SearchState>(),
                  ] as const);
                }

                return Effect.gen(function* () {
                  const page = yield* fetchPage(
                    state.query,
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
                      ? Option.none<SearchState>()
                      : Option.some({
                          query: state.query,
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
