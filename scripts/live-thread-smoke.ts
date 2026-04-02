import { Effect, Layer } from "effect";

import {
  CookieManager,
  getConversationProjection,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterTweets,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";
import { ObservabilityCapture } from "../src/observability-capture";

const THREAD_CANARY_TWEET_ID = "1665602315745673217";

const liveThreadLayer = TwitterTweets.layer.pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(UserAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer()),
  Layer.provideMerge(TwitterConfig.defaultLayer()),
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
      const thread = yield* tweets.getThread(THREAD_CANARY_TWEET_ID);
      const projection = getConversationProjection(document);

      if (!projection) {
        throw new Error("Thread projection did not return conversation context.");
      }

      if (thread.length <= 1) {
        throw new Error("Thread lookup did not return a multi-tweet thread.");
      }

      if (thread[0]?.id !== THREAD_CANARY_TWEET_ID) {
        throw new Error("Thread lookup did not return the canary root first.");
      }

      if (projection.conversationRoot.id !== THREAD_CANARY_TWEET_ID) {
        throw new Error("Thread projection did not preserve the canary root.");
      }

      if (projection.selfThread.length !== thread.length) {
        throw new Error(
          "Thread projection self-thread chain did not match the convenience API.",
        );
      }

      const spans = yield* capture.spans;
      const strategyCalls = spans
        .filter((span) => span.name === "ScraperStrategy.execute")
        .map((span) => ({
          authMode: String(span.attributes.auth_mode ?? ""),
          endpointId: String(span.attributes.endpoint_id ?? ""),
        }));

      return {
        conversationRootId: projection.conversationRoot.id,
        observability: {
          strategyCalls,
        },
        replyChainIds: projection.replyChain.map((tweet) => tweet.id),
        threadIds: thread.map((tweet) => tweet.id),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(liveThreadLayer, ObservabilityCapture.layer()),
      ),
    ),
  );

  console.log(JSON.stringify(result));
};

await main();
