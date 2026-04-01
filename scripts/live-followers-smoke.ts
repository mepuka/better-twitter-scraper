import { Effect, Layer, Stream } from "effect";

import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
  TwitterRelationships,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";
import { ObservabilityCapture } from "../src/observability-capture";

const liveFollowersLayer = Layer.mergeAll(
  TwitterPublic.layer,
  TwitterRelationships.layer,
).pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
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
      const publicApi = yield* TwitterPublic;
      const relationships = yield* TwitterRelationships;

      yield* auth.restoreCookies(cookies);

      if (!(yield* auth.isLoggedIn())) {
        throw new Error("Restored cookies did not produce a signed-in session.");
      }

      const profile = yield* publicApi.getProfile("nomadic_ua");
      if (!profile.userId) {
        throw new Error("Resolved profile did not include a userId.");
      }

      const loadFollowers = () =>
        Stream.runCollect(relationships.getFollowers(profile.userId!, { limit: 1 }));

      const followers = yield* loadFollowers().pipe(
        Effect.catchTag("BotDetectionError", () =>
          Effect.sleep("1 second").pipe(Effect.andThen(loadFollowers())),
        ),
      );

      if (followers.length === 0) {
        throw new Error("Followers lookup returned no profiles.");
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
        followers: followers.map((item) => item.username),
        profile: {
          userId: profile.userId,
          username: profile.username,
        },
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(liveFollowersLayer, ObservabilityCapture.layer()),
      ),
    ),
  );

  console.log(JSON.stringify(result));
};

await main();
