import { Effect, Layer, ServiceMap } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";

import { CookieManager } from "./cookies";
import { TwitterTransactionId } from "./transaction-id";
import { UserAuth } from "./user-auth";
import { createStrategyExecute, type StrategyError } from "./strategy";
import type { ApiRequest } from "./request";
import { TwitterXpff } from "./xpff";

export class UserScraperStrategy extends ServiceMap.Service<
  UserScraperStrategy,
  {
    readonly execute: (
      request: ApiRequest<unknown>,
    ) => Effect.Effect<unknown, StrategyError>;
  }
>()("@better-twitter-scraper/UserScraperStrategy") {
  static readonly standardLayer = Layer.effect(
    UserScraperStrategy,
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const cookies = yield* CookieManager;
      const http = yield* HttpClient.HttpClient;
      const transactionId = yield* TwitterTransactionId;
      const xpff = yield* TwitterXpff;

      return {
        execute: createStrategyExecute(auth, cookies, http, (request) =>
          Effect.all([
            transactionId.headerFor(request.request),
            xpff.headerFor(),
          ]).pipe(
            Effect.map(([transactionHeaders, xpffHeaders]) => ({
              ...transactionHeaders,
              ...xpffHeaders,
            })),
          ),
        ),
      };
    }),
  );
}
