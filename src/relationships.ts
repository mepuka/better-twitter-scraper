import { Effect, Layer, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError } from "./errors";
import type { GetProfilesOptions, Profile, TimelinePage } from "./models";
import { paginateTimeline } from "./pagination";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { UserAuth } from "./user-auth";

type RelationshipsError = AuthenticationError | StrategyError;

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
        strategy.execute(
          endpointRegistry.followers(
            userId,
            Math.min(count, config.search.maxPageSize),
            cursor,
          ),
        ),
      );

      const fetchFollowingPage = Effect.fn(
        "TwitterRelationships.fetchFollowingPage",
      )((userId: string, count: number, cursor?: string) =>
        strategy.execute(
          endpointRegistry.following(
            userId,
            Math.min(count, config.search.maxPageSize),
            cursor,
          ),
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

            return paginateTimeline({
              remaining: options.limit ?? config.search.defaultLimit,
              fetchPage: (cursor, remaining) =>
                fetchPage(userId, remaining, cursor),
            });
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
