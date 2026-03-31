import { Effect, Layer, ServiceMap } from "effect";

import { CookieManager, type SerializedCookie } from "./cookies";
import { TwitterConfig } from "./config";
import { buildBaseHeaders } from "./header-policy";
import { RequestAuth } from "./request-auth";
import { TwitterTransactionId } from "./transaction-id";
import { TwitterXpff } from "./xpff";

const makeBaseUserAuthLayer = () =>
  Layer.effect(
    UserAuth,
    Effect.gen(function* () {
      const cookies = yield* CookieManager;

      const isLoggedIn = Effect.fn("UserAuth.isLoggedIn")(function* () {
        const csrfToken = yield* cookies.get("ct0");
        const authToken = yield* cookies.get("auth_token");
        return Boolean(csrfToken && authToken);
      });

      const restoreCookies = Effect.fn("UserAuth.restoreCookies")(function* (
        serializedCookies: Iterable<SerializedCookie>,
      ) {
        yield* cookies.clear;
        yield* cookies.restoreSerializedCookies(serializedCookies);
      });

      return {
        invalidate: Effect.void,
        isLoggedIn: () => isLoggedIn(),
        restoreCookies,
        serializeCookies: cookies.serializeCookies,
      };
    }),
  );

const makeUserRequestAuthLayer = () =>
  Layer.effect(
    RequestAuth,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const cookies = yield* CookieManager;
      const transactionId = yield* TwitterTransactionId;
      const xpff = yield* TwitterXpff;

      return {
        headersFor: Effect.fn("RequestAuth.userHeadersFor")(function* (request) {
          const cookieHeader = yield* cookies.getCookieHeader;
          const csrfToken = yield* cookies.get("ct0");
          const baseHeaders = buildBaseHeaders({
            config,
            request,
            ...(cookieHeader ? { cookieHeader } : {}),
            ...(csrfToken ? { csrfToken } : {}),
          });
          const transactionHeaders = yield* transactionId.headerFor({
            method: request.method,
            url: request.url,
          });
          const xpffHeaders = yield* xpff.headerFor();

          return {
            ...baseHeaders,
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-client-language": "en",
            ...transactionHeaders,
            ...xpffHeaders,
          } as const;
        }),
        invalidate: Effect.void,
      };
    }),
  );

export class UserAuth extends ServiceMap.Service<
  UserAuth,
  {
    readonly invalidate: Effect.Effect<void>;
    readonly isLoggedIn: () => Effect.Effect<boolean>;
    readonly restoreCookies: (
      serializedCookies: Iterable<SerializedCookie>,
    ) => Effect.Effect<void>;
    readonly serializeCookies: Effect.Effect<readonly string[]>;
  }
>()("@better-twitter-scraper/UserAuth") {
  static get liveLayer() {
    return Layer.mergeAll(
      makeBaseUserAuthLayer(),
      makeUserRequestAuthLayer().pipe(
        Layer.provideMerge(makeBaseUserAuthLayer()),
      ),
    ).pipe(
      Layer.provideMerge(TwitterXpff.liveLayer),
      Layer.provideMerge(TwitterTransactionId.liveLayer),
    );
  }

  static testLayer(options: {
    readonly transactionId?: string;
    readonly xpff?: string;
  } = {}) {
    return Layer.mergeAll(
      makeBaseUserAuthLayer(),
      makeUserRequestAuthLayer().pipe(
        Layer.provideMerge(makeBaseUserAuthLayer()),
      ),
    ).pipe(
      Layer.provideMerge(TwitterXpff.testLayer(options.xpff)),
      Layer.provideMerge(TwitterTransactionId.testLayer(options.transactionId)),
    );
  }
}
