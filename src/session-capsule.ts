import { Effect, Option } from "effect";

import type * as HttpCookies from "effect/unstable/http/Cookies";

import type { TwitterConfigShape } from "./config";
import {
  createCookieStore,
  type CookieStoreInstance,
  type SerializedCookie,
} from "./cookies";
import {
  type HttpStatusError,
  type InvalidResponseError,
  type TransportError,
} from "./errors";
import { createGuestAuthInstances } from "./guest-auth";
import { createRateLimiterInstance, type RateLimiterInstance } from "./rate-limiter";
import type { PreparedApiRequest } from "./request";
import type { RequestAuthHelper } from "./request-auth";
import { createTransactionIdInstance } from "./transaction-id";
import { createUserRequestAuthInstance } from "./user-auth";
import { createXpffInstance } from "./xpff";

export interface SessionCapsule {
  readonly id: number;
  readonly cookies: CookieStoreInstance;
  readonly guest: Option.Option<RequestAuthHelper>;
  readonly user: RequestAuthHelper;
  readonly rateLimiter: RateLimiterInstance;
  readonly canHandleUserAuth: () => Effect.Effect<boolean>;
}

export const createSessionCapsule = (
  id: number,
  serializedCookies: ReadonlyArray<SerializedCookie>,
  shared: {
    readonly config: TwitterConfigShape;
    readonly transactionIdOverride?: {
      readonly headerFor: (
        request: { readonly method: string; readonly url: string },
      ) => Effect.Effect<Readonly<Record<string, string>>, any>;
    };
    readonly http: {
      readonly execute: <A>(
        request: PreparedApiRequest<A>,
      ) => Effect.Effect<
        {
          readonly headers: Readonly<Record<string, string>>;
          readonly cookies: HttpCookies.Cookies;
          readonly body: string | unknown;
        },
        HttpStatusError | InvalidResponseError | TransportError
      >;
    };
  },
) =>
  Effect.gen(function* () {
    // 1. Fresh cookie store
    const cookies = yield* createCookieStore();

    // 2. Restore serialized cookies
    yield* cookies.restoreSerializedCookies(serializedCookies);

    // 3. Fresh rate limiter
    const rateLimiter = yield* createRateLimiterInstance();

    // 4. XPFF instance
    const xpff = yield* createXpffInstance({ getCookie: cookies.get });

    // 5. Guest auth instances
    const { guestRequestAuth } = yield* createGuestAuthInstances({
      config: shared.config,
      cookies,
      execute: shared.http.execute,
    });

    // 6. Session-scoped transaction IDs and user request auth
    const transactionId = shared.transactionIdOverride
      ? shared.transactionIdOverride
      : yield* createTransactionIdInstance({
          config: shared.config,
          http: shared.http,
          cookies,
        });
    const user = yield* createUserRequestAuthInstance({
      cookies,
      config: shared.config,
      transactionId,
      xpff,
    });

    // 7. Build and return capsule
    const canHandleUserAuth = () =>
      Effect.gen(function* () {
        const ct0 = yield* cookies.get("ct0");
        const authToken = yield* cookies.get("auth_token");
        return Boolean(ct0 && authToken);
      });

    return {
      id,
      cookies,
      guest: Option.some(guestRequestAuth),
      user,
      rateLimiter,
      canHandleUserAuth,
    } satisfies SessionCapsule;
  });
