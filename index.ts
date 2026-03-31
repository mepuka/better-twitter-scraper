import { Layer } from "effect";

import { CookieManager } from "./src/cookies";
import { TwitterConfig } from "./src/config";
import { GuestAuth } from "./src/guest-auth";
import { TwitterHttpClient } from "./src/http";
import { TwitterPublic } from "./src/public";
import { TwitterSearch } from "./src/search";
import { ScraperStrategy } from "./src/strategy";
import { TwitterTransactionId } from "./src/transaction-id";
import { UserAuth } from "./src/user-auth";
import { UserScraperStrategy } from "./src/user-strategy";
import { TwitterXpff } from "./src/xpff";

export * from "./src/config";
export * from "./src/cookies";
export * from "./src/endpoints";
export * from "./src/errors";
export * from "./src/guest-auth";
export * from "./src/http";
export * from "./src/models";
export * from "./src/public";
export * from "./src/request";
export * from "./src/search";
export * from "./src/strategy";
export * from "./src/user-auth";
export * from "./src/user-strategy";

export const twitterPublicLiveLayer = TwitterPublic.layer.pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.liveLayer),
  Layer.provideMerge(TwitterConfig.layer),
);

export const twitterSearchLiveLayer = TwitterSearch.layer.pipe(
  Layer.provideMerge(UserScraperStrategy.standardLayer),
  Layer.provideMerge(TwitterXpff.liveLayer),
  Layer.provideMerge(TwitterTransactionId.liveLayer),
  Layer.provideMerge(UserAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer),
  Layer.provideMerge(TwitterConfig.layer),
);
