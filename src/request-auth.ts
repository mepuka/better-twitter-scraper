import { Effect, ServiceMap } from "effect";

import {
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import type { ApiRequest } from "./request";

export type RequestAuthError =
  | GuestTokenError
  | HttpStatusError
  | InvalidResponseError
  | TransportError;

export class RequestAuth extends ServiceMap.Service<
  RequestAuth,
  {
    readonly headersFor: (
      request: ApiRequest<unknown>,
    ) => Effect.Effect<Readonly<Record<string, string>>, RequestAuthError>;
    readonly invalidate: Effect.Effect<void>;
  }
>()("@better-twitter-scraper/RequestAuth") {}
