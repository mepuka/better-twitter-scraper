import { Effect, Layer, ServiceMap } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { CookieManager } from "./cookies";
import { GuestAuth } from "./guest-auth";
import {
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  ProfileNotFoundError,
  TransportError,
} from "./errors";
import {
  decodeJsonResponse,
  ensureSuccessStatus,
  mapHttpClientError,
} from "./http-client-utils";
import type { ApiRequest } from "./request";

export type StrategyError =
  | GuestTokenError
  | HttpStatusError
  | InvalidResponseError
  | ProfileNotFoundError
  | TransportError;

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

      const executeOnce = <A>(request: ApiRequest<A>) =>
        Effect.gen(function* () {
          const headers = yield* auth.headersFor({
            family: request.family,
            bearerToken: request.bearerToken,
          });

          const response = yield* http.execute(
            request.request.pipe(HttpClientRequest.setHeaders(headers)),
          ).pipe(Effect.mapError(mapHttpClientError));

          yield* cookies.applySetCookies(response.cookies);

          if (response.headers["x-rate-limit-incoming"] === "0") {
            yield* auth.invalidate;
          }

          const okResponse = yield* ensureSuccessStatus(
            request.endpointId,
            response,
          );

          return yield* decodeJsonResponse(request, okResponse);
        });

      const execute = (request: ApiRequest<unknown>) =>
        executeOnce(request).pipe(
          Effect.catchTag("HttpStatusError", (error) =>
            request.bearerToken === "default" &&
            (error.status === 401 || error.status === 403)
              ? auth.invalidate.pipe(Effect.flatMap(() => executeOnce(request)))
              : Effect.fail(error),
          ),
          Effect.withSpan(`ScraperStrategy.execute.${request.endpointId}`),
        );

      return { execute };
    }),
  );
}
