import { Effect, Layer } from "effect";

import {
  CookieManager,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterTweets,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";
import { ObservabilityCapture } from "../src/observability-capture";

const THREAD_CANARY_TWEET_ID = "1665602315745673217";

const liveTweetDetailLayer = TwitterTweets.layer.pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(UserAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer),
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
      const tweets = yield* TwitterTweets;

      yield* auth.restoreCookies(cookies);

      if (!(yield* auth.isLoggedIn())) {
        throw new Error("Restored cookies did not produce a signed-in session.");
      }

      const document = yield* tweets.getTweet(THREAD_CANARY_TWEET_ID);
      if (document.focalTweetId !== THREAD_CANARY_TWEET_ID) {
        throw new Error("Tweet detail did not return the requested focal tweet.");
      }

      if (document.tweets.length <= 1) {
        throw new Error("Tweet detail did not return a conversation graph.");
      }

      const spans = yield* capture.spans;
      const strategyCalls = spans
        .filter((span) => span.name === "ScraperStrategy.execute")
        .map((span) => ({
          authMode: String(span.attributes.auth_mode ?? ""),
          endpointId: String(span.attributes.endpoint_id ?? ""),
        }));

      return {
        focalTweetId: document.focalTweetId,
        observability: {
          strategyCalls,
        },
        tweetCount: document.tweets.length,
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(liveTweetDetailLayer, ObservabilityCapture.layer()),
      ),
    ),
  );

  console.log(JSON.stringify(result));
};

await main();
