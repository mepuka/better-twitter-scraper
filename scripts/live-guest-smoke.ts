import { Effect, Layer, Stream } from "effect";

import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
} from "../index";
import { ObservabilityCapture } from "../src/observability-capture";

const livePublicLayer = TwitterPublic.layer.pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer()),
  Layer.provideMerge(TwitterConfig.testLayer()),
);

const main = async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const capture = yield* ObservabilityCapture;
      const publicApi = yield* TwitterPublic;
      const profile = yield* publicApi.getProfile("nomadic_ua");
      const tweets = yield* Stream.runCollect(
        publicApi.getTweets("XDevelopers", { limit: 3 }),
      );
      const spans = yield* capture.spans;

      return {
        observability: {
          spanNames: [...new Set(spans.map((span) => span.name))].sort(),
        },
        profile: {
          userId: profile.userId,
          username: profile.username,
        },
        tweets: tweets.map((tweet) => ({
          id: tweet.id,
        })),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(livePublicLayer, ObservabilityCapture.layer()),
      ),
    ),
  );

  console.log(JSON.stringify(result));
};

await main();
