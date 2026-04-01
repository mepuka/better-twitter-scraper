import { Effect, Layer, ServiceMap } from "effect";

import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError, InvalidResponseError } from "./errors";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { UserAuth } from "./user-auth";

type TrendsError = AuthenticationError | InvalidResponseError | StrategyError;

export class TwitterTrends extends ServiceMap.Service<
  TwitterTrends,
  {
    readonly getTrends: () => Effect.Effect<readonly string[], TrendsError>;
  }
>()("@better-twitter-scraper/TwitterTrends") {
  static readonly layer = Layer.effect(
    TwitterTrends,
    Effect.gen(function* () {
      yield* TwitterConfig;

      const auth = yield* UserAuth;
      const strategy = yield* ScraperStrategy;

      const getTrends = Effect.fn("TwitterTrends.getTrends")(() =>
        Effect.gen(function* () {
          const loggedIn = yield* auth.isLoggedIn();
          if (!loggedIn) {
            return yield* new AuthenticationError({
              reason: "Authenticated trends lookup requires restored session cookies.",
            });
          }

          return yield* (strategy.execute(
            endpointRegistry.trends(),
          ) as Effect.Effect<readonly string[], TrendsError>);
        }).pipe(Effect.withSpan("TwitterTrends.getTrends")),
      );

      return { getTrends };
    }),
  );
}
