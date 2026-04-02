import { Effect, Layer, ServiceMap, Stream } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import type { GetProfilesOptions, Profile, TimelinePage } from "./models";
import { paginateTimeline } from "./pagination";
import { ScraperStrategy, type StrategyError } from "./strategy";

type RelationshipsError = StrategyError;

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
        fetchPage: (
          userId: string,
          count: number,
          cursor?: string,
        ) => Effect.Effect<TimelinePage<Profile>, StrategyError>,
      ) =>
        paginateTimeline({
          remaining: options.limit ?? config.search.defaultLimit,
          jitterMs: config.pagination.jitterMs,
          fetchPage: (cursor, remaining) =>
            fetchPage(userId, remaining, cursor),
        });

      const getFollowers = (
        userId: string,
        options: GetProfilesOptions = {},
      ) =>
        streamProfiles(
          userId,
          options,
          fetchFollowersPage,
        );

      const getFollowing = (
        userId: string,
        options: GetProfilesOptions = {},
      ) =>
        streamProfiles(
          userId,
          options,
          fetchFollowingPage,
        );

      return {
        getFollowers,
        getFollowing,
      };
    }),
  );
}
