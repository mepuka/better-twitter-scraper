import { Effect, Layer, ServiceMap } from "effect";

import { CookieManager, type SerializedCookie } from "./cookies";
import { TwitterConfig } from "./config";
import type { BearerTokenName, EndpointFamily } from "./request";

export class UserAuth extends ServiceMap.Service<
  UserAuth,
  {
    readonly headersFor: (options: {
      readonly family: EndpointFamily;
      readonly bearerToken: BearerTokenName;
    }) => Effect.Effect<Readonly<Record<string, string>>>;
    readonly invalidate: Effect.Effect<void>;
    readonly isLoggedIn: () => Effect.Effect<boolean>;
    readonly restoreCookies: (
      serializedCookies: Iterable<SerializedCookie>,
    ) => Effect.Effect<void>;
    readonly serializeCookies: Effect.Effect<readonly string[]>;
  }
>()("@better-twitter-scraper/UserAuth") {
  static readonly liveLayer = Layer.effect(
    UserAuth,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
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

      const headersFor = Effect.fn("UserAuth.headersFor")(function* (options: {
        readonly family: EndpointFamily;
        readonly bearerToken: BearerTokenName;
      }) {
        const cookieHeader = yield* cookies.getCookieHeader;
        const csrfToken = yield* cookies.get("ct0");

        const headers: Record<string, string> = {
          ...config.requestProfile.commonHeaders,
          authorization: `Bearer ${
            options.bearerToken === "secondary"
              ? config.bearerTokens.secondary
              : config.bearerTokens.default
          }`,
        };

        if (options.family === "graphql") {
          Object.assign(headers, config.requestProfile.graphqlHeaders);
        }

        if (cookieHeader) {
          headers.cookie = cookieHeader;
        }

        if (csrfToken) {
          headers["x-csrf-token"] = csrfToken;
        }

        headers["x-twitter-auth-type"] = "OAuth2Session";
        headers["x-twitter-active-user"] = "yes";
        headers["x-twitter-client-language"] = "en";

        return headers;
      });

      return {
        headersFor,
        invalidate: Effect.void,
        isLoggedIn: () => isLoggedIn(),
        restoreCookies,
        serializeCookies: cookies.serializeCookies,
      };
    }),
  );
}
