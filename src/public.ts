import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { InvalidResponseError } from "./errors";
import type { GetTweetsOptions, Profile, TimelinePage, Tweet } from "./models";
import { ScraperStrategy, type StrategyError } from "./strategy";

type PublicError = StrategyError | InvalidResponseError;

interface TweetStreamState {
  readonly userId: string;
  readonly cursor?: string;
  readonly remaining: number;
  readonly seenCursors: ReadonlySet<string>;
}

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
          (strategy.execute(
            endpointRegistry.userByScreenName(username),
          ) as Effect.Effect<Profile, StrategyError>).pipe(
            Effect.withSpan("TwitterPublic.getProfile"),
          ),
      );

      const fetchTweetsPage = Effect.fn("TwitterPublic.fetchTweetsPage")(
        (userId: string, count: number, cursor?: string) =>
          (strategy.execute(
            endpointRegistry.userTweets(
              userId,
              Math.min(count, config.timeline.maxPageSize),
              config.timeline.includePromotedContent,
              cursor,
            ),
          ) as Effect.Effect<TimelinePage<Tweet>, StrategyError>).pipe(
            Effect.withSpan("TwitterPublic.fetchTweetsPage"),
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

            const initialState: TweetStreamState = {
              userId,
              remaining: options.limit ?? config.timeline.defaultLimit,
              seenCursors: new Set<string>(),
            };

            return Stream.paginate<TweetStreamState, Tweet, PublicError>(
              initialState,
              (state) => {
                if (state.remaining <= 0) {
                  return Effect.succeed([[], Option.none<TweetStreamState>()] as const);
                }

                return Effect.gen(function* () {
                  const page = yield* fetchTweetsPage(
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

      return {
        getProfile,
        getTweets,
      };
    }),
  );
}
