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

const liveLayer = TwitterSearch.layer.pipe(
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

      const tweets = yield* Stream.runCollect(
        search.searchTweets("Twitter", { limit: 2, mode: "top" }),
      );

      if (tweets.length === 0) {
        throw new Error("Tweet search returned no tweets.");
      }

      const spans = yield* capture.spans;
      const strategyCalls = spans
        .filter((span) => span.name === "ScraperStrategy.execute")
        .map((span) => ({
          authMode: String(span.attributes.auth_mode ?? ""),
          endpointId: String(span.attributes.endpoint_id ?? ""),
        }));

      return {
        observability: {
          strategyCalls,
        },
        tweets: tweets.map((tweet) => ({
          id: tweet.id,
          username: tweet.username,
        })),
      };
    }).pipe(
      Effect.provide(Layer.mergeAll(liveLayer, ObservabilityCapture.layer())),
    ),
  );

  console.log(JSON.stringify(result));
};

await main();
