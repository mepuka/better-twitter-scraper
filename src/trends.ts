import { Cache, Duration, Effect, Exit, Layer, ServiceMap } from "effect";

import { endpointRegistry } from "./endpoints";
import { AuthenticationError, InvalidResponseError } from "./errors";
import { TwitterSessionState } from "./session-state";
import { ScraperStrategy, type StrategyError } from "./strategy";

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
      const sessionState = yield* TwitterSessionState;
      const strategy = yield* ScraperStrategy;
      const trendsCache = yield* Cache.makeWith<string, readonly string[], StrategyError>(
        {
          capacity: 4,
          lookup: () =>
            strategy.execute(endpointRegistry.trends()),
          timeToLive: (exit) =>
            Exit.isSuccess(exit) ? Duration.seconds(30) : Duration.millis(0),
        },
      );

      const getTrends = Effect.fn("TwitterTrends.getTrends")(() =>
        Effect.gen(function* () {
          const loggedIn = yield* sessionState.isLoggedIn();
          if (!loggedIn) {
            return yield* new AuthenticationError({
              reason: "Authenticated trends lookup requires restored session cookies.",
            });
          }

          const key = yield* sessionState.cacheKey;
          return yield* Cache.get(trendsCache, key);
        }),
      );

      return { getTrends };
    }),
  );
}
