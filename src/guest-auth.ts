import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  ServiceMap,
} from "effect";

import { CookieManager, type CookieStoreInstance } from "./cookies";
import { TwitterConfig, type TwitterConfigShape } from "./config";
import { endpointRegistry } from "./endpoints";
import {
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import { buildBaseHeaders } from "./header-policy";
import { TwitterHttpClient } from "./http";
import { GuestRequestAuth, type RequestAuthHelper } from "./request-auth";
import { prepareApiRequest, type PreparedApiRequest } from "./request";

import type * as HttpCookies from "effect/unstable/http/Cookies";

const invalidGuestActivationPayload = (reason: string) =>
  new InvalidResponseError({
    endpointId: "GuestActivate",
    reason,
  });

export type GuestAuthInstance = {
  readonly invalidate: Effect.Effect<void>;
  readonly currentToken: () => Effect.Effect<
    string,
    GuestTokenError | HttpStatusError | InvalidResponseError | TransportError
  >;
  readonly snapshot: Effect.Effect<{
    readonly hasToken: boolean;
    readonly authenticatedAt: number | null;
  }>;
};

export type GuestAuthInstances = {
  readonly guestAuth: GuestAuthInstance;
  readonly guestRequestAuth: RequestAuthHelper;
};

type GuestActivationWaiter = Deferred.Deferred<
  string,
  GuestTokenError | HttpStatusError | InvalidResponseError | TransportError
>;

export const createGuestAuthInstances = (deps: {
  readonly config: TwitterConfigShape;
  readonly cookies: CookieStoreInstance;
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
}) =>
  Effect.gen(function* () {
    const { config, cookies, execute } = deps;
    const tokenRef = yield* Ref.make(Option.none<string>());
    const authenticatedAtRef = yield* Ref.make(Option.none<number>());
    const activationRef = yield* Ref.make(Option.none<GuestActivationWaiter>());

    const invalidate = Effect.gen(function* () {
      yield* Ref.set(tokenRef, Option.none<string>());
      yield* Ref.set(authenticatedAtRef, Option.none<number>());
    });

    const activate = Effect.fn("GuestAuth.activate")(() =>
      Effect.gen(function* () {
        const request = endpointRegistry.guestActivate(config.urls.guestActivate);
        const cookieHeader = yield* cookies.getCookieHeader;
        const csrfToken = yield* cookies.get("ct0");
        const headers = buildBaseHeaders({
          config,
          request,
          ...(cookieHeader ? { cookieHeader } : {}),
          ...(csrfToken ? { csrfToken } : {}),
        });

        const response = yield* execute(prepareApiRequest(request, headers));

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
      }),
    );

    const currentToken = Effect.fn("GuestAuth.currentToken")(() =>
      Effect.gen(function* () {
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

        const deferred = yield* Deferred.make<
          string,
          GuestTokenError | HttpStatusError | InvalidResponseError | TransportError
        >();
        const inFlight: {
          readonly deferred: GuestActivationWaiter;
          readonly shouldActivate: boolean;
        } = yield* Ref.modify(activationRef, (current) => {
          if (Option.isSome(current)) {
            return [
              {
                deferred: current.value,
                shouldActivate: false as boolean,
              },
              current,
            ] as const;
          }

          return [
            {
              deferred,
              shouldActivate: true as boolean,
            },
            Option.some(deferred),
          ] as const;
        });

        if (inFlight.shouldActivate) {
          yield* Deferred.complete(
            inFlight.deferred,
            activate().pipe(
              Effect.ensuring(Ref.set(activationRef, Option.none())),
            ),
          );
        }

        return yield* Deferred.await(inFlight.deferred);
      }),
    );

    const snapshot = Effect.gen(function* () {
      const token = yield* Ref.get(tokenRef);
      const authenticatedAt = yield* Ref.get(authenticatedAtRef);

      return {
        hasToken: Option.isSome(token),
        authenticatedAt: Option.isSome(authenticatedAt)
          ? authenticatedAt.value
          : null,
      } as const;
    });

    const guestAuth: GuestAuthInstance = {
      invalidate,
      currentToken: () => currentToken(),
      snapshot,
    };

    const guestRequestAuth: RequestAuthHelper = {
      headersFor: Effect.fn("GuestRequestAuth.headersFor")(function* (
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
          // Guest token required for default bearer — fail if unavailable
          return {
            ...headers,
            "x-guest-token": yield* guestAuth.currentToken(),
          } as const;
        }

        if (
          request.authRequirement === "guest" &&
          request.bearerToken === "secondary"
        ) {
          // Guest token optional for secondary bearer — best-effort
          const token = yield* guestAuth.currentToken().pipe(
            Effect.option,
          );
          if (Option.isSome(token)) {
            return { ...headers, "x-guest-token": token.value } as const;
          }
        }

        return headers;
      }),
      invalidate: guestAuth.invalidate,
    };

    return { guestAuth, guestRequestAuth } satisfies GuestAuthInstances;
  });

export class GuestAuth extends ServiceMap.Service<
  GuestAuth,
  GuestAuthInstance
>()("@better-twitter-scraper/GuestAuth") {
  static get liveLayer() {
    return createGuestAuthContextLayer();
  }
}

/** @internal shared instances produced by createGuestAuthInstances */
class GuestAuthInstances_ extends ServiceMap.Service<
  GuestAuthInstances_,
  GuestAuthInstances
>()("@better-twitter-scraper/GuestAuthInstances_") {}

function createGuestAuthContextLayer() {
  const instancesLayer = Layer.effect(
    GuestAuthInstances_,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const cookies = yield* CookieManager;
      const http = yield* TwitterHttpClient;

      return yield* createGuestAuthInstances({
        config,
        cookies,
        execute: http.execute,
      });
    }),
  );

  const guestAuthLayer = Layer.effect(
    GuestAuth,
    Effect.gen(function* () {
      const instances = yield* GuestAuthInstances_;
      return instances.guestAuth;
    }),
  );

  const requestAuthLayer = Layer.effect(
    GuestRequestAuth,
    Effect.gen(function* () {
      const instances = yield* GuestAuthInstances_;
      return instances.guestRequestAuth;
    }),
  );

  return Layer.mergeAll(guestAuthLayer, requestAuthLayer).pipe(
    Layer.provideMerge(instancesLayer),
  );
}
