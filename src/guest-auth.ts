import { Clock, Duration, Effect, Layer, Option, Ref, ServiceMap } from "effect";

import { CookieManager } from "./cookies";
import { TwitterConfig } from "./config";
import { endpointRegistry } from "./endpoints";
import {
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import { buildBaseHeaders } from "./header-policy";
import { TwitterHttpClient } from "./http";
import { RequestAuth } from "./request-auth";
import { prepareApiRequest } from "./request";

const invalidGuestActivationPayload = (reason: string) =>
  new InvalidResponseError({
    endpointId: "GuestActivate",
    reason,
  });

export class GuestAuth extends ServiceMap.Service<
  GuestAuth,
  {
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
  static get liveLayer() {
    return createGuestAuthContextLayer();
  }
}

function createGuestAuthContextLayer() {
  const guestAuthLayer = Layer.effect(
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
        const request = endpointRegistry.guestActivate(config.urls.guestActivate);
        const cookieHeader = yield* cookies.getCookieHeader;
        const csrfToken = yield* cookies.get("ct0");
        const headers = buildBaseHeaders({
          config,
          request,
          ...(cookieHeader ? { cookieHeader } : {}),
          ...(csrfToken ? { csrfToken } : {}),
        });

        const response = yield* http.execute(prepareApiRequest(request, headers));

        yield* cookies.applySetCookies(response.cookies);

        const guestToken =
          response.body &&
          typeof response.body === "object" &&
          "guest_token" in response.body &&
          typeof response.body.guest_token === "string"
            ? response.body.guest_token
            : yield* invalidGuestActivationPayload(
                "Guest activation did not return a guest_token string.",
              );

        const now = yield* Clock.currentTimeMillis;
        yield* cookies.put("gt", guestToken);
        yield* Ref.set(tokenRef, Option.some(guestToken));
        yield* Ref.set(authenticatedAtRef, Option.some(now));

        return guestToken;
      });

      const currentToken = Effect.fn("GuestAuth.currentToken")(function* () {
        const existingToken = yield* Ref.get(tokenRef);
        const authenticatedAt = yield* Ref.get(authenticatedAtRef);
        const now = yield* Clock.currentTimeMillis;

        if (
          Option.isSome(existingToken) &&
          Option.isSome(authenticatedAt) &&
          now - authenticatedAt.value < Duration.toMillis(config.guestTokenTtl)
        ) {
          return existingToken.value;
        }

        return yield* activate();
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
        invalidate,
        currentToken: () => currentToken(),
        snapshot,
      };
    }),
  );

  const requestAuthLayer = Layer.effect(
    RequestAuth,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const cookies = yield* CookieManager;
      const guestAuth = yield* GuestAuth;

      return {
        headersFor: Effect.fn("RequestAuth.guestHeadersFor")(function* (
          request,
        ) {
          const cookieHeader = yield* cookies.getCookieHeader;
          const csrfToken = yield* cookies.get("ct0");
          const headers = buildBaseHeaders({
            config,
            request,
            ...(cookieHeader ? { cookieHeader } : {}),
            ...(csrfToken ? { csrfToken } : {}),
          });

          if (
            request.authRequirement === "guest" &&
            request.bearerToken === "default" &&
            request.family !== "activation"
          ) {
            return {
              ...headers,
              "x-guest-token": yield* guestAuth.currentToken(),
            } as const;
          }

          return headers;
        }),
        invalidate: guestAuth.invalidate,
      };
    }),
  );

  return Layer.mergeAll(
    guestAuthLayer,
    requestAuthLayer.pipe(Layer.provideMerge(guestAuthLayer)),
  );
}
