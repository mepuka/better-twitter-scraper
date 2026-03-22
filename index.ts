import { Layer } from "effect";

import { CookieManager } from "./src/cookies";
import { TwitterConfig } from "./src/config";
import { GuestAuth } from "./src/guest-auth";
import { TwitterHttpClient } from "./src/http";
import { TwitterPublic } from "./src/public";
import { ScraperStrategy } from "./src/strategy";

export * from "./src/config";
export * from "./src/cookies";
export * from "./src/endpoints";
export * from "./src/errors";
export * from "./src/guest-auth";
export * from "./src/http";
export * from "./src/models";
export * from "./src/public";
export * from "./src/request";
export * from "./src/strategy";

export const twitterPublicLiveLayer = TwitterPublic.layer.pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.liveLayer),
  Layer.provideMerge(TwitterConfig.layer),
);
