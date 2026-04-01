import { Effect, Layer, ServiceMap } from "effect";

import { CookieManager, type CookieStoreInstance, type SerializedCookie } from "./cookies";
import { TwitterConfig, type TwitterConfigShape } from "./config";
import { buildBaseHeaders } from "./header-policy";
import { type RequestAuthHelper, UserRequestAuth } from "./request-auth";
import { TwitterTransactionId } from "./transaction-id";
import { TwitterXpff, type XpffInstance } from "./xpff";

export type UserAuthInstance = {
  readonly invalidate: Effect.Effect<void>;
  readonly isLoggedIn: () => Effect.Effect<boolean>;
  readonly restoreCookies: (
    serializedCookies: Iterable<SerializedCookie>,
  ) => Effect.Effect<void>;
  readonly serializeCookies: Effect.Effect<readonly string[]>;
};

export const createUserAuthInstance = (deps: {
  readonly cookies: CookieStoreInstance;
}) =>
  Effect.gen(function* () {
    const { cookies } = deps;

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
    } satisfies UserAuthInstance;
  });

export const createUserRequestAuthInstance = (deps: {
  readonly cookies: CookieStoreInstance;
  readonly config: TwitterConfigShape;
  readonly transactionId: {
    readonly headerFor: (
      request: { readonly method: string; readonly url: string },
    ) => Effect.Effect<Readonly<Record<string, string>>, any>;
  };
  readonly xpff: XpffInstance;
}) =>
  Effect.gen(function* () {
    const { cookies, config, transactionId, xpff } = deps;

    return {
      headersFor: Effect.fn("UserRequestAuth.headersFor")(function* (request) {
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
    } satisfies RequestAuthHelper;
  });

const makeBaseUserAuthLayer = () =>
  Layer.effect(
    UserAuth,
    Effect.gen(function* () {
      const cookies = yield* CookieManager;
      return yield* createUserAuthInstance({ cookies });
    }),
  );

const makeUserRequestAuthLayer = () =>
  Layer.effect(
    UserRequestAuth,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const cookies = yield* CookieManager;
      const transactionId = yield* TwitterTransactionId;
      const xpff = yield* TwitterXpff;

      return yield* createUserRequestAuthInstance({
        cookies,
        config,
        transactionId,
        xpff,
      });
    }),
  );

export class UserAuth extends ServiceMap.Service<
  UserAuth,
  UserAuthInstance
>()("@better-twitter-scraper/UserAuth") {
  static get liveLayer() {
    const baseLayer = makeBaseUserAuthLayer();

    return Layer.mergeAll(baseLayer, makeUserRequestAuthLayer()).pipe(
      Layer.provideMerge(TwitterXpff.liveLayer),
      Layer.provideMerge(TwitterTransactionId.liveLayer),
    );
  }

  static testLayer(options: {
    readonly transactionId?: string;
    readonly xpff?: string;
  } = {}) {
    const baseLayer = makeBaseUserAuthLayer();

    return Layer.mergeAll(baseLayer, makeUserRequestAuthLayer()).pipe(
      Layer.provideMerge(TwitterXpff.testLayer(options.xpff)),
      Layer.provideMerge(TwitterTransactionId.testLayer(options.transactionId)),
    );
  }
}
