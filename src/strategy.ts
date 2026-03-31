import { Effect, Layer, ServiceMap } from "effect";

import type * as Cookies from "effect/unstable/http/Cookies";

import { CookieManager } from "./cookies";
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
  decodeParsedBody,
} from "./http-client-utils";
import { TwitterHttpClient } from "./http";
import { RequestAuth, type RequestAuthError } from "./request-auth";
import {
  prepareApiRequest,
  type ApiRequest,
  type PreparedApiRequest,
} from "./request";

export type StrategyError =
  | AuthenticationError
  | BotDetectionError
  | GuestTokenError
  | HttpStatusError
  | InvalidResponseError
  | ProfileNotFoundError
  | RateLimitError
  | RequestAuthError
  | TransportError;

export interface StrategyCookies {
  readonly applySetCookies: (
    setCookies: Cookies.Cookies,
  ) => Effect.Effect<void>;
}

interface StrategyRequestAuth {
  readonly headersFor: (
    request: ApiRequest<unknown>,
  ) => Effect.Effect<Readonly<Record<string, string>>, RequestAuthError>;
  readonly invalidate: Effect.Effect<void>;
}

interface StrategyTransport {
  readonly execute: <A>(
    request: PreparedApiRequest<A>,
  ) => Effect.Effect<
    {
      readonly headers: Readonly<Record<string, string>>;
      readonly cookies: Cookies.Cookies;
      readonly body: string | unknown;
    },
    HttpStatusError | InvalidResponseError | TransportError
  >;
}

export const createStrategyExecute = (
  auth: StrategyRequestAuth,
  cookies: StrategyCookies,
  http: StrategyTransport,
) => {
  const executeOnce = <A>(
    request: ApiRequest<A>,
  ): Effect.Effect<A, StrategyError> =>
    Effect.gen(function* () {
      const headers = yield* auth.headersFor(request);
      const response = yield* http.execute(prepareApiRequest(request, headers));

      yield* cookies.applySetCookies(response.cookies);

      if (response.headers["x-rate-limit-incoming"] === "0") {
        yield* auth.invalidate;
      }

      return yield* decodeParsedBody(request, response.body);
    });

  return <A>(request: ApiRequest<A>): Effect.Effect<A, StrategyError> =>
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
    readonly execute: <A>(
      request: ApiRequest<A>,
    ) => Effect.Effect<A, StrategyError>;
  }
>()("@better-twitter-scraper/ScraperStrategy") {
  static get standardLayer() {
    return Layer.effect(
      ScraperStrategy,
      Effect.gen(function* () {
        const auth = yield* RequestAuth;
        const cookies = yield* CookieManager;
        const http = yield* TwitterHttpClient;

        return {
          execute: createStrategyExecute(auth, cookies, http),
        };
      }),
    );
  }
}
