import { Effect, Layer, Stream } from "effect";

import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
} from "../index";

const livePublicLayer = TwitterPublic.layer.pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer),
  Layer.provideMerge(TwitterConfig.testLayer()),
);

const main = async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const publicApi = yield* TwitterPublic;
      const profile = yield* publicApi.getProfile("nomadic_ua");
      const repeatedProfile = yield* publicApi.getProfile("nomadic_ua");
      const tweets = yield* Stream.runCollect(
        publicApi.getTweets("XDevelopers", { limit: 3 }),
      );

      return {
        profile: {
          userId: profile.userId,
          username: profile.username,
        },
        repeatedProfile: {
          userId: repeatedProfile.userId,
        },
        tweets: tweets.map((tweet) => ({
          id: tweet.id,
        })),
      };
    }).pipe(Effect.provide(livePublicLayer)),
  );

  console.log(JSON.stringify(result));
};

await main();
