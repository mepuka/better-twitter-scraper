import { Clock, Effect, Layer, Option, Ref, ServiceMap } from "effect";

import { CookieManager } from "./cookies";
import { TwitterConfig, type TwitterConfigShape } from "./config";
import {
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import { TwitterHttpClient } from "./http";
import type { BearerTokenName, EndpointFamily } from "./request";

const browserHeaders = (
  config: TwitterConfigShape,
): Readonly<Record<string, string>> => ({
  "user-agent": config.browser.userAgent,
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": config.browser.secChUa,
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  referer: "https://x.com/",
  origin: "https://x.com",
  "sec-fetch-site": "same-site",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
  priority: "u=1, i",
});

export class GuestAuth extends ServiceMap.Service<
  GuestAuth,
  {
    readonly headersFor: (options: {
      readonly url: string;
      readonly family: EndpointFamily;
      readonly bearerToken: BearerTokenName;
    }) => Effect.Effect<
      Readonly<Record<string, string>>,
      GuestTokenError | HttpStatusError | InvalidResponseError | TransportError
    >;
    readonly invalidate: Effect.Effect<void>;
    readonly currentToken: () => Effect.Effect<
      string,
      GuestTokenError | HttpStatusError | InvalidResponseError | TransportError
    >;
    readonly snapshot: Effect.Effect<{
      readonly token: string | null;
      readonly authenticatedAt: number | null;
    }>;
  }
>()("@better-twitter-scraper/GuestAuth") {
  static readonly liveLayer = Layer.effect(
    GuestAuth,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const cookies = yield* CookieManager;
      const http = yield* TwitterHttpClient;
      const tokenRef = yield* Ref.make(Option.none<string>());
      const authenticatedAtRef = yield* Ref.make(Option.none<number>());

      const invalidate = Effect.gen(function* () {
        yield* Ref.set(tokenRef, Option.none<string>());
        yield* Ref.set(authenticatedAtRef, Option.none<number>());
      });

      const activate = Effect.fn("GuestAuth.activate")(function* () {
        const cookieHeader = yield* cookies.getCookieHeader;
        const response = yield* http.execute({
          method: "POST",
          url: config.guestActivateUrl,
          headers: {
            ...browserHeaders(config),
            authorization: `Bearer ${config.bearerTokens.default}`,
            "content-type": "application/x-www-form-urlencoded",
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
          },
        });

        yield* cookies.applySetCookies(response.setCookies);

        if (response.status < 200 || response.status >= 300) {
          return yield* new HttpStatusError({
            endpointId: "GuestActivate",
            status: response.status,
            body: response.bodyText.slice(0, 500),
          });
        }

        const payload = yield* Effect.try({
          try: () => JSON.parse(response.bodyText) as { guest_token?: unknown },
          catch: () =>
            new InvalidResponseError({
              endpointId: "GuestActivate",
              reason: "Guest activation returned invalid JSON",
            }),
        });

        if (typeof payload.guest_token !== "string") {
          return yield* new GuestTokenError({
            reason: "guest_token was missing from the activation response",
          });
        }

        const now = yield* Clock.currentTimeMillis;
        yield* cookies.put("gt", payload.guest_token);
        yield* Ref.set(tokenRef, Option.some(payload.guest_token));
        yield* Ref.set(authenticatedAtRef, Option.some(now));

        return payload.guest_token;
      });

      const currentToken = Effect.fn("GuestAuth.currentToken")(function* () {
        const existingToken = yield* Ref.get(tokenRef);
        const authenticatedAt = yield* Ref.get(authenticatedAtRef);
        const now = yield* Clock.currentTimeMillis;

        if (
          Option.isSome(existingToken) &&
          Option.isSome(authenticatedAt) &&
          now - authenticatedAt.value < config.guestTokenTtlMs
        ) {
          return existingToken.value;
        }

        return yield* activate();
      });

      const headersFor = Effect.fn("GuestAuth.headersFor")(function* (options: {
        readonly url: string;
        readonly family: EndpointFamily;
        readonly bearerToken: BearerTokenName;
      }) {
        const cookieHeader = yield* cookies.getCookieHeader;
        const csrfToken = yield* cookies.get("ct0");

        const headers: Record<string, string> = {
          ...browserHeaders(config),
          authorization: `Bearer ${
            options.bearerToken === "secondary"
              ? config.bearerTokens.secondary
              : config.bearerTokens.default
          }`,
        };

        if (options.family === "graphql") {
          headers["content-type"] = "application/json";
        }

        if (cookieHeader) {
          headers.cookie = cookieHeader;
        }

        if (csrfToken) {
          headers["x-csrf-token"] = csrfToken;
        }

        if (options.bearerToken === "default") {
          headers["x-guest-token"] = yield* currentToken();
        }

        return headers;
      });

      const snapshot = Effect.gen(function* () {
        const token = yield* Ref.get(tokenRef);
        const authenticatedAt = yield* Ref.get(authenticatedAtRef);

        return {
          token: Option.isSome(token) ? token.value : null,
          authenticatedAt: Option.isSome(authenticatedAt)
            ? authenticatedAt.value
            : null,
        } as const;
      });

      return {
        headersFor,
        invalidate,
        currentToken: () => currentToken(),
        snapshot,
      };
    }),
  );
}
