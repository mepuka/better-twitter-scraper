import { Effect, Layer, Stream } from "effect";

import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
  TwitterSearch,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";
import { ObservabilityCapture } from "../src/observability-capture";

const liveMixedLayer = Layer.mergeAll(TwitterPublic.layer, TwitterSearch.layer).pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
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
      const publicApi = yield* TwitterPublic;
      const search = yield* TwitterSearch;

      yield* auth.restoreCookies(cookies);

      if (!(yield* auth.isLoggedIn())) {
        throw new Error("Restored cookies did not produce a signed-in session.");
      }

      const profile = yield* publicApi.getProfile("nomadic_ua");
      const profiles = yield* Stream.runCollect(
        search.searchProfiles("Twitter", { limit: 2 }),
      );

      if (profiles.length === 0) {
        throw new Error("Authenticated profile search returned no profiles.");
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
        profile: {
          username: profile.username,
        },
        usernames: profiles.map((item) => item.username),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(liveMixedLayer, ObservabilityCapture.layer()),
      ),
    ),
  );

  console.log(JSON.stringify(result));
};

await main();
