import { Clock, Effect, Layer, Option, Ref, Schema, ServiceMap } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { CookieManager } from "./cookies";
import { TwitterConfig } from "./config";
import {
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import {
  ensureSuccessStatus,
  mapHttpClientError,
} from "./http-client-utils";
import type { BearerTokenName, EndpointFamily } from "./request";

const GuestActivationPayload = Schema.Struct({
  guest_token: Schema.String,
});

export class GuestAuth extends ServiceMap.Service<
  GuestAuth,
  {
    readonly headersFor: (options: {
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
      const http = yield* HttpClient.HttpClient;
      const tokenRef = yield* Ref.make(Option.none<string>());
      const authenticatedAtRef = yield* Ref.make(Option.none<number>());

      const invalidate = Effect.gen(function* () {
        yield* Ref.set(tokenRef, Option.none<string>());
        yield* Ref.set(authenticatedAtRef, Option.none<number>());
      });

      const headersFor = Effect.fn("GuestAuth.headersFor")(function* (options: {
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

        if (options.bearerToken === "default") {
          headers["x-guest-token"] = yield* currentToken();
        }

        return headers;
      });

      const activate = Effect.fn("GuestAuth.activate")(function* () {
        const cookieHeader = yield* cookies.getCookieHeader;
        const request = HttpClientRequest.post(config.urls.guestActivate).pipe(
          HttpClientRequest.bodyUrlParams({}),
          HttpClientRequest.setHeaders({
            ...config.requestProfile.commonHeaders,
            authorization: `Bearer ${config.bearerTokens.default}`,
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
          }),
        );

        const response = yield* http.execute(request).pipe(
          Effect.mapError(mapHttpClientError),
        );

        yield* cookies.applySetCookies(response.cookies);

        const okResponse = yield* ensureSuccessStatus("GuestActivate", response);

        const payload = yield* HttpClientResponse.schemaBodyJson(
          GuestActivationPayload,
        )(okResponse).pipe(
          Effect.mapError(
            (error) =>
              new InvalidResponseError({
                endpointId: "GuestActivate",
                reason: error.message,
              }),
          ),
        );

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
