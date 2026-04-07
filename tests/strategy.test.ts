import { Effect, Option } from "effect";
import * as Cookies from "effect/unstable/http/Cookies";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import {
  mergeKnownQueryIds,
  resolveRequestQueryIds,
} from "../src/endpoint-catalog";
import { HttpStatusError } from "../src/errors";
import type { RequestAuthHelper } from "../src/request-auth";
import type { ApiRequest } from "../src/request";
import {
  createStrategyExecute,
  type StrategyCookies,
  type StrategyError,
} from "../src/strategy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopCookies: StrategyCookies = {
  applySetCookies: () => Effect.void,
};

const noopRateLimiter = {
  awaitReady: () => Effect.void,
  noteRateLimit: () => Effect.void,
  noteResponse: () =>
    Effect.succeed({ incomingExhausted: false } as const),
};

const noopEndpointCatalog = {
  resolveRequest: <A>(request: ApiRequest<A>) => Effect.succeed(request),
  updateQueryIds: () => Effect.void,
};

/** Build a minimal RequestAuthHelper whose headersFor returns empty headers. */
const stubAuth = (tag: string): RequestAuthHelper => ({
  headersFor: () => Effect.succeed({ "x-auth-mode": tag }),
  invalidate: Effect.void,
});

/**
 * Build a scripted StrategyTransport that responds with a queue of scripted
 * responses. Each call to `execute` pops the next response from the front.
 */
const scriptedTransport = (
  responses: Array<
    | { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }
    | { readonly json: unknown; readonly headers?: Record<string, string> }
  >,
) => {
  let index = 0;
  return {
    execute: <A>() => {
      const entry = responses[index++];
      if (!entry) {
        return Effect.die(new Error("scriptedTransport exhausted"));
      }

      if ("json" in entry) {
        return Effect.succeed({
          headers: entry.headers ?? {},
          cookies: Cookies.empty,
          body: entry.json,
        });
      }

      if (entry.status >= 200 && entry.status < 300) {
        return Effect.succeed({
          headers: entry.headers ?? {},
          cookies: Cookies.empty,
          body: entry.body ?? "",
        });
      }

      return Effect.fail(
        new HttpStatusError({
          endpointId: "Test",
          status: entry.status,
          body: entry.body ?? "",
          headers: entry.headers ?? {},
        }),
      );
    },
  };
};

/** Extract the error from a failing effect as a resolved value. */
const extractError = <A>(
  effect: Effect.Effect<A, StrategyError>,
): Effect.Effect<StrategyError, never> =>
  Effect.matchEffect(effect, {
    onSuccess: () => Effect.die(new Error("Expected effect to fail but it succeeded")),
    onFailure: (error) => Effect.succeed(error),
  });

/** Minimal user-auth request that targets a guest-eligible endpoint. */
const makeUserRequest = (overrides?: Partial<ApiRequest<string>>): ApiRequest<string> => ({
  endpointId: "UserTweets",
  family: "graphql",
  authRequirement: "user",
  bearerToken: "default",
  rateLimitBucket: "userTweets",
  graphqlOperationName: "UserTweets",
  method: "GET",
  url: "https://api.x.com/graphql/test/UserTweets",
  responseKind: "json",
  decode: (body) => JSON.stringify(body),
  ...overrides,
});

const makeGuestRequest = (overrides?: Partial<ApiRequest<string>>): ApiRequest<string> => ({
  ...makeUserRequest(),
  authRequirement: "guest",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createStrategyExecute error propagation", () => {
  it.effect("propagates rate limit error for guest auth requests", () => {
    // Guest request hitting 429 should just fail — no fallback.
    const transport = scriptedTransport([
      { status: 429, headers: { "x-rate-limit-limit": "100", "x-rate-limit-remaining": "0" } },
    ]);

    const execute = createStrategyExecute(
      {
        guest: Option.some(stubAuth("guest")),
        user: Option.some(stubAuth("user")),
      },
      noopCookies,
      transport,
      noopRateLimiter,
      "scripted",
      noopEndpointCatalog,
      Option.none(),
      0,
    );

    return Effect.gen(function* () {
      const result = yield* extractError(execute(makeGuestRequest()));
      expect(result._tag).toBe("RateLimitError");
    });
  });

  it.effect("does NOT fall back on BotDetectionError", () => {
    // status 399 is classified as BotDetectionError — no fallback should happen
    const transport = scriptedTransport([
      { status: 399 },
    ]);

    const execute = createStrategyExecute(
      {
        guest: Option.some(stubAuth("guest")),
        user: Option.some(stubAuth("user")),
      },
      noopCookies,
      transport,
      noopRateLimiter,
      "scripted",
      noopEndpointCatalog,
      Option.none(),
      0,
    );

    return Effect.gen(function* () {
      const result = yield* extractError(execute(makeUserRequest()));
      expect(result._tag).toBe("BotDetectionError");
    });
  });

  it.effect("does NOT fall back when no guest auth is available", () => {
    const transport = scriptedTransport([
      { status: 429, headers: { "x-rate-limit-limit": "100", "x-rate-limit-remaining": "0" } },
    ]);

    const execute = createStrategyExecute(
      {
        guest: Option.none(),
        user: Option.some(stubAuth("user")),
      },
      noopCookies,
      transport,
      noopRateLimiter,
      "scripted",
      noopEndpointCatalog,
      Option.none(),
      0,
    );

    return Effect.gen(function* () {
      const result = yield* extractError(execute(makeUserRequest()));
      expect(result._tag).toBe("RateLimitError");
    });
  });

  it.effect("refreshes GraphQL query IDs once after an empty 404", () => {
    let queryIds = new Map([["UserTweets", "stale-id"]]) as ReadonlyMap<string, string>;
    const seenUrls: string[] = [];
    const transport = {
      execute: <A>(request: { readonly url: string }) => {
        seenUrls.push(request.url);
        return seenUrls.length === 1
          ? Effect.fail(
              new HttpStatusError({
                endpointId: "UserTweets",
                status: 404,
                body: "",
                headers: {},
              }),
            )
          : Effect.succeed({
              headers: {},
              cookies: Cookies.empty,
              body: { ok: true },
            } as const);
      },
    };

    const endpointCatalog = {
      resolveRequest: <A>(request: ApiRequest<A>) =>
        Effect.succeed(resolveRequestQueryIds(request, queryIds)),
      updateQueryIds: (discovered: ReadonlyMap<string, string>) =>
        Effect.sync(() => {
          queryIds = mergeKnownQueryIds(queryIds, discovered);
        }),
    };

    const execute = createStrategyExecute(
      {
        guest: Option.some(stubAuth("guest")),
        user: Option.some(stubAuth("user")),
      },
      noopCookies,
      transport,
      noopRateLimiter,
      "scripted",
      endpointCatalog,
      Option.some({
        refreshQueryIds: () =>
          Effect.succeed(new Map([["UserTweets", "fresh-id"]])),
      }),
      0,
    );

    return Effect.gen(function* () {
      const result = yield* execute(
        makeUserRequest({
          url: "https://api.x.com/graphql/stale-id/UserTweets",
        }),
      );
      expect(JSON.parse(result)).toEqual({ ok: true });
      expect(seenUrls).toEqual([
        "https://api.x.com/graphql/stale-id/UserTweets",
        "https://api.x.com/graphql/fresh-id/UserTweets",
      ]);
    });
  });

});
