import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError } from "./errors";
import type { GetProfilesOptions, Profile, TimelinePage } from "./models";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { UserAuth } from "./user-auth";

type RelationshipsError = AuthenticationError | StrategyError;

interface RelationshipState {
  readonly cursor?: string;
  readonly remaining: number;
  readonly seenCursors: ReadonlySet<string>;
  readonly userId: string;
}

export class TwitterRelationships extends ServiceMap.Service<
  TwitterRelationships,
  {
    readonly getFollowers: (
      userId: string,
      options?: GetProfilesOptions,
    ) => Stream.Stream<Profile, RelationshipsError>;
    readonly getFollowing: (
      userId: string,
      options?: GetProfilesOptions,
    ) => Stream.Stream<Profile, RelationshipsError>;
  }
>()("@better-twitter-scraper/TwitterRelationships") {
  static readonly layer = Layer.effect(
    TwitterRelationships,
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const config = yield* TwitterConfig;
      const strategy = yield* ScraperStrategy;

      const fetchFollowersPage = Effect.fn(
        "TwitterRelationships.fetchFollowersPage",
      )((userId: string, count: number, cursor?: string) =>
        (strategy.execute(
          endpointRegistry.followers(
            userId,
            Math.min(count, config.search.maxPageSize),
            cursor,
          ),
        ) as Effect.Effect<TimelinePage<Profile>, StrategyError>).pipe(
          Effect.withSpan("TwitterRelationships.fetchFollowersPage"),
        ),
      );

      const fetchFollowingPage = Effect.fn(
        "TwitterRelationships.fetchFollowingPage",
      )((userId: string, count: number, cursor?: string) =>
        (strategy.execute(
          endpointRegistry.following(
            userId,
            Math.min(count, config.search.maxPageSize),
            cursor,
          ),
        ) as Effect.Effect<TimelinePage<Profile>, StrategyError>).pipe(
          Effect.withSpan("TwitterRelationships.fetchFollowingPage"),
        ),
      );

      const streamProfiles = (
        userId: string,
        options: GetProfilesOptions,
        authErrorReason: string,
        fetchPage: (
          userId: string,
          count: number,
          cursor?: string,
        ) => Effect.Effect<TimelinePage<Profile>, StrategyError>,
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const loggedIn = yield* auth.isLoggedIn();
            if (!loggedIn) {
              return yield* new AuthenticationError({
                reason: authErrorReason,
              });
            }

            const initialState: RelationshipState = {
              userId,
              remaining: options.limit ?? config.search.defaultLimit,
              seenCursors: new Set<string>(),
            };

            return Stream.paginate<RelationshipState, Profile, RelationshipsError>(
              initialState,
              (state) => {
                if (state.remaining <= 0) {
                  return Effect.succeed([
                    [],
                    Option.none<RelationshipState>(),
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
                      ? Option.none<RelationshipState>()
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

      const getFollowers = (
        userId: string,
        options: GetProfilesOptions = {},
      ) =>
        streamProfiles(
          userId,
          options,
          "Authenticated followers lookup requires restored session cookies.",
          fetchFollowersPage,
        );

      const getFollowing = (
        userId: string,
        options: GetProfilesOptions = {},
      ) =>
        streamProfiles(
          userId,
          options,
          "Authenticated following lookup requires restored session cookies.",
          fetchFollowingPage,
        );

      return {
        getFollowers,
        getFollowing,
      };
    }),
  );
}
