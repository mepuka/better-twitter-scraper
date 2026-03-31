import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError } from "./errors";
import type { GetProfilesOptions, Profile, TimelinePage } from "./models";
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
          (strategy.execute(
            endpointRegistry.searchProfiles(
              query,
              Math.min(count, config.search.maxPageSize),
              cursor,
            ),
          ) as Effect.Effect<TimelinePage<Profile>, StrategyError>).pipe(
            Effect.withSpan("TwitterSearch.fetchProfilesPage"),
          ),
      );

      const searchProfiles = (
        query: string,
        options: GetProfilesOptions = {},
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

            return Stream.paginate<SearchState, Profile, SearchError>(
              initialState,
              (state) => {
                if (state.remaining <= 0) {
                  return Effect.succeed([
                    [],
                    Option.none<SearchState>(),
                  ] as const);
                }

                return Effect.gen(function* () {
                  const page = yield* fetchProfilesPage(
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

      return { searchProfiles };
    }),
  );
}
