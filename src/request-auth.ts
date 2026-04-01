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

export interface RequestAuthHelper {
  readonly headersFor: (
    request: ApiRequest<unknown>,
  ) => Effect.Effect<Readonly<Record<string, string>>, RequestAuthError>;
  readonly invalidate: Effect.Effect<void>;
}

export class GuestRequestAuth extends ServiceMap.Service<
  GuestRequestAuth,
  RequestAuthHelper
>()("@better-twitter-scraper/GuestRequestAuth") {}

export class UserRequestAuth extends ServiceMap.Service<
  UserRequestAuth,
  RequestAuthHelper
>()("@better-twitter-scraper/UserRequestAuth") {}
