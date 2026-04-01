import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError, InvalidResponseError } from "./errors";
import type { GetTweetsOptions, TimelinePage, Tweet } from "./models";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { UserAuth } from "./user-auth";

type ListTimelineError = AuthenticationError | InvalidResponseError | StrategyError;

interface ListStreamState {
  readonly cursor?: string;
  readonly listId: string;
  readonly remaining: number;
  readonly seenCursors: ReadonlySet<string>;
}

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
      const auth = yield* UserAuth;
      const strategy = yield* ScraperStrategy;

      const fetchTweetsPage = Effect.fn("TwitterLists.fetchTweetsPage")(
        (listId: string, count: number, cursor?: string) =>
          strategy.execute(
            endpointRegistry.listTweets(listId, count, cursor),
          ) as Effect.Effect<TimelinePage<Tweet>, StrategyError>,
      );

      const getTweets = (listId: string, options: GetTweetsOptions = {}) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const loggedIn = yield* auth.isLoggedIn();
            if (!loggedIn) {
              return yield* new AuthenticationError({
                reason:
                  "Authenticated list timeline lookup requires restored session cookies.",
              });
            }

            const initialState: ListStreamState = {
              listId,
              remaining: options.limit ?? config.timeline.defaultLimit,
              seenCursors: new Set<string>(),
            };

            return Stream.paginate<ListStreamState, Tweet, ListTimelineError>(
              initialState,
              (state) => {
                if (state.remaining <= 0) {
                  return Effect.succeed([[], Option.none<ListStreamState>()] as const);
                }

                return Effect.gen(function* () {
                  const page = yield* fetchTweetsPage(
                    state.listId,
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
                      ? Option.none<ListStreamState>()
                      : Option.some({
                          listId: state.listId,
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
          }).pipe(Effect.withSpan("TwitterLists.getTweets")),
        );

      return {
        getTweets,
      };
    }),
  );
}
