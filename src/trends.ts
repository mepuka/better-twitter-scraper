import { Cache, Duration, Effect, Exit, Layer, ServiceMap } from "effect";

import { CookieManager } from "./cookies";
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
      const auth = yield* UserAuth;
      const cookies = yield* CookieManager;
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

      const cacheKey = Effect.fn("TwitterTrends.cacheKey")(function* () {
        const snapshot = yield* cookies.snapshot;
        const authToken = snapshot.auth_token ?? "";
        const csrfToken = snapshot.ct0 ?? "";
        return `${authToken}\u0000${csrfToken}`;
      });

      const getTrends = Effect.fn("TwitterTrends.getTrends")(() =>
        Effect.gen(function* () {
          const loggedIn = yield* auth.isLoggedIn();
          if (!loggedIn) {
            return yield* new AuthenticationError({
              reason: "Authenticated trends lookup requires restored session cookies.",
            });
          }

          const key = yield* cacheKey();
          return yield* Cache.get(trendsCache, key);
        }),
      );

      return { getTrends };
    }),
  );
}
