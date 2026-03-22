import { Effect, Layer, ServiceMap } from "effect";

import { CookieManager } from "./cookies";
import { GuestAuth } from "./guest-auth";
import {
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  ProfileNotFoundError,
  TransportError,
} from "./errors";
import { TwitterHttpClient } from "./http";
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
      const http = yield* TwitterHttpClient;

      const decodeResponse = <A>(request: ApiRequest<A>, bodyText: string) =>
        Effect.try({
          try: () => {
            const parsedBody = JSON.parse(bodyText);
            return request.decode(parsedBody);
          },
          catch: (error) => {
            if (error instanceof ProfileNotFoundError) {
              return error;
            }

            if (error instanceof InvalidResponseError) {
              return error;
            }

            return new InvalidResponseError({
              endpointId: request.endpointId,
              reason:
                error instanceof Error
                  ? error.message
                  : "Failed to decode Twitter response",
            });
          },
        });

      const executeOnce = <A>(request: ApiRequest<A>) =>
        Effect.gen(function* () {
          const headers = yield* auth.headersFor({
            url: request.url,
            family: request.family,
            bearerToken: request.bearerToken,
          });

          const response = yield* http.execute({
            method: request.method,
            url: request.url,
            headers,
          });

          yield* cookies.applySetCookies(response.setCookies);

          if (response.headers["x-rate-limit-incoming"] === "0") {
            yield* auth.invalidate;
          }

          if (response.status < 200 || response.status >= 300) {
            return yield* new HttpStatusError({
              endpointId: request.endpointId,
              status: response.status,
              body: response.bodyText.slice(0, 500),
            });
          }

          return yield* decodeResponse(request, response.bodyText);
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
