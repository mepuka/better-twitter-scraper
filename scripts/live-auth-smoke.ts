import { Effect, Layer, Stream } from "effect";

import {
  CookieManager,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterSearch,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";
import { ObservabilityCapture } from "../src/observability-capture";

const liveSearchLayer = TwitterSearch.layer.pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(UserAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer()),
  Layer.provideMerge(TwitterConfig.testLayer()),
);

const main = async () => {
  const { cookies, error } = loadSerializedCookies();

  if (error) {
    throw error;
  }

  if (!cookies || cookies.length === 0) {
    throw new Error(
      "No serialized cookies were found. Set TWITTER_COOKIES or run bun run cookies:extract.",
    );
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const capture = yield* ObservabilityCapture;
      const search = yield* TwitterSearch;

      yield* auth.restoreCookies(cookies);

      if (!(yield* auth.isLoggedIn())) {
        throw new Error("Restored cookies did not produce a signed-in session.");
      }

      const firstProfiles = yield* Stream.runCollect(
        search.searchProfiles("Twitter", { limit: 2 }),
      );
      const secondProfiles = yield* Stream.runCollect(
        search.searchProfiles("Twitter", { limit: 2 }),
      );

      if (firstProfiles.length === 0 || secondProfiles.length === 0) {
        throw new Error("Authenticated profile search returned no profiles.");
      }

      const spans = yield* capture.spans;

      return {
        observability: {
          spanNames: [...new Set(spans.map((span) => span.name))].sort(),
        },
        usernames: secondProfiles.map((profile) => profile.username),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(liveSearchLayer, ObservabilityCapture.layer()),
      ),
    ),
  );

  console.log(JSON.stringify(result));
};

await main();
