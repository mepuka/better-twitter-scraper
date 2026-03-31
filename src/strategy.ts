import { Effect, Layer, ServiceMap } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import type * as Cookies from "effect/unstable/http/Cookies";

import { CookieManager } from "./cookies";
import { GuestAuth } from "./guest-auth";
import {
  AuthenticationError,
  BotDetectionError,
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  ProfileNotFoundError,
  RateLimitError,
  TransportError,
} from "./errors";
import {
  classifyHttpStatusError,
  decodeJsonResponse,
  ensureSuccessStatus,
  mapHttpClientError,
} from "./http-client-utils";
import type { ApiRequest } from "./request";

export type StrategyError =
  | AuthenticationError
  | BotDetectionError
  | GuestTokenError
  | HttpStatusError
  | InvalidResponseError
  | ProfileNotFoundError
  | RateLimitError
  | TransportError;

export interface StrategyAuth {
  readonly headersFor: (options: {
    readonly family: ApiRequest<unknown>["family"];
    readonly bearerToken: ApiRequest<unknown>["bearerToken"];
  }) => Effect.Effect<Readonly<Record<string, string>>, StrategyError>;
  readonly invalidate: Effect.Effect<void>;
}

export interface StrategyCookies {
  readonly applySetCookies: (
    setCookies: Cookies.Cookies,
  ) => Effect.Effect<void>;
}

export type StrategyHeaderDecorator = (
  request: ApiRequest<unknown>,
) => Effect.Effect<Readonly<Record<string, string>>, StrategyError>;

export const createStrategyExecute = (
  auth: StrategyAuth,
  cookies: StrategyCookies,
  http: HttpClient.HttpClient,
  decorateHeaders?: StrategyHeaderDecorator,
) => {
  const executeOnce = <A>(
    request: ApiRequest<A>,
  ): Effect.Effect<A, StrategyError> =>
    Effect.gen(function* () {
      const baseHeaders = yield* auth.headersFor({
        family: request.family,
        bearerToken: request.bearerToken,
      });
      const decoratedHeaders = decorateHeaders
        ? yield* decorateHeaders(request)
        : {};
      const headers = {
        ...baseHeaders,
        ...decoratedHeaders,
      };

      const response = yield* http.execute(
        request.request.pipe(HttpClientRequest.setHeaders(headers)),
      ).pipe(Effect.mapError(mapHttpClientError));

      yield* cookies.applySetCookies(response.cookies);

      if (response.headers["x-rate-limit-incoming"] === "0") {
        yield* auth.invalidate;
      }

      const okResponse = yield* ensureSuccessStatus(request.endpointId, response);

      return yield* decodeJsonResponse(request, okResponse);
    });

  return (request: ApiRequest<unknown>): Effect.Effect<unknown, StrategyError> =>
    executeOnce(request).pipe(
      Effect.catchTag("HttpStatusError", (error) =>
        request.bearerToken === "default" && (error.status === 401 || error.status === 403)
          ? auth.invalidate.pipe(Effect.flatMap(() => executeOnce(request)))
          : Effect.fail(error),
      ),
      Effect.catchTag("HttpStatusError", (error) =>
        Effect.fail(classifyHttpStatusError(request, error)),
      ),
      Effect.withSpan(`ScraperStrategy.execute.${request.endpointId}`),
    );
};

export class ScraperStrategy extends ServiceMap.Service<
  ScraperStrategy,
  {
    readonly execute: (
      request: ApiRequest<unknown>,
    ) => Effect.Effect<unknown, StrategyError>;
  }
>()("@better-twitter-scraper/ScraperStrategy") {
  static readonly standardLayer = Layer.effect(
    ScraperStrategy,
    Effect.gen(function* () {
      const auth = yield* GuestAuth;
      const cookies = yield* CookieManager;
      const http = yield* HttpClient.HttpClient;
      return { execute: createStrategyExecute(auth, cookies, http) };
    }),
  );
}
