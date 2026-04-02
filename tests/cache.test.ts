import { Effect, Layer } from "effect";
import * as Cookies from "effect/unstable/http/Cookies";
import { TestClock } from "effect/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CookieManager,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterTrends,
  UserAuth,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import { HttpStatusError } from "../src/errors";
import { transportMetadataLayer } from "../src/observability";
import { type PreparedApiRequest } from "../src/request";
import { UserRequestAuth } from "../src/request-auth";
import { SignedInSessionRevision } from "../src/signed-in-session-revision";
import { TwitterTransactionId } from "../src/transaction-id";
import { trendsFixture } from "./fixtures";

const { createTransactionMock } = vi.hoisted(() => ({
  createTransactionMock: vi.fn(),
}));

vi.mock("x-client-transaction-id", () => ({
  default: {
    create: createTransactionMock,
  },
}));

const restoredSessionCookies = [
  "ct0=csrf-token; Path=/; Domain=x.com",
  "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
] as const;

const otherRestoredSessionCookies = [
  "ct0=csrf-token-2; Path=/; Domain=x.com",
  "auth_token=session-token-2; Path=/; Domain=x.com; HttpOnly",
] as const;

const emptyHeaders = {} as const;

const successHtml = "<!doctype html><html><head></head><body>ok</body></html>";

const makeHttpStatusError = (endpointId: string) =>
  new HttpStatusError({
    endpointId,
    status: 500,
    body: "boom",
    headers: {},
  });

const countingHttpLayer = (
  handler: (
    request: PreparedApiRequest<unknown>,
  ) => Effect.Effect<
    {
      readonly headers: Readonly<Record<string, string>>;
      readonly cookies: Cookies.Cookies;
      readonly body: string | unknown;
    },
    HttpStatusError
  >,
) =>
  Layer.mergeAll(
    transportMetadataLayer("scripted"),
    Layer.succeed(TwitterHttpClient, {
      execute: handler,
    }),
  );

const transactionIdLayer = (
  handler: (
    request: PreparedApiRequest<unknown>,
  ) => Effect.Effect<
    {
      readonly headers: Readonly<Record<string, string>>;
      readonly cookies: Cookies.Cookies;
      readonly body: string | unknown;
    },
    HttpStatusError
  >,
) =>
  TwitterTransactionId.liveLayer.pipe(
    Layer.provideMerge(SignedInSessionRevision.liveLayer),
    Layer.provideMerge(countingHttpLayer(handler)),
    Layer.provideMerge(TwitterConfig.defaultLayer()),
  );

const liveUserAuthLayer = (
  handler: (
    request: PreparedApiRequest<unknown>,
  ) => Effect.Effect<
    {
      readonly headers: Readonly<Record<string, string>>;
      readonly cookies: Cookies.Cookies;
      readonly body: string | unknown;
    },
    HttpStatusError
  >,
) =>
  UserAuth.liveLayer.pipe(
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(countingHttpLayer(handler)),
    Layer.provideMerge(TwitterConfig.defaultLayer()),
  );

const trendsLayer = (
  handler: (
    request: PreparedApiRequest<unknown>,
  ) => Effect.Effect<
    {
      readonly headers: Readonly<Record<string, string>>;
      readonly cookies: Cookies.Cookies;
      readonly body: string | unknown;
    },
    HttpStatusError
  >,
) =>
  TwitterTrends.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(countingHttpLayer(handler)),
    Layer.provideMerge(TwitterConfig.defaultLayer()),
  );

beforeEach(() => {
  createTransactionMock.mockReset();
  createTransactionMock.mockResolvedValue({
    generateTransactionId: vi.fn().mockResolvedValue("mock-transaction-id"),
  });
});

describe("Effect-native cache pass", () => {
  it("reuses the signed-in transaction document within TTL and reloads it after expiry", async () => {
    let callCount = 0;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transactionId = yield* TwitterTransactionId;

          const first = yield* transactionId.headerFor({
            method: "GET",
            url: "https://api.x.com/graphql/test/First",
          });
          const second = yield* transactionId.headerFor({
            method: "GET",
            url: "https://api.x.com/graphql/test/Second",
          });

          expect(first["x-client-transaction-id"]).toBe("mock-transaction-id");
          expect(second["x-client-transaction-id"]).toBe("mock-transaction-id");
          expect(callCount).toBe(1);

          yield* TestClock.adjust("300001 millis");

          const third = yield* transactionId.headerFor({
            method: "GET",
            url: "https://api.x.com/graphql/test/Third",
          });

          expect(third["x-client-transaction-id"]).toBe("mock-transaction-id");
          expect(callCount).toBe(2);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              TestClock.layer(),
              transactionIdLayer(() =>
                Effect.sync(() => {
                  callCount += 1;
                  return {
                    headers: emptyHeaders,
                    cookies: Cookies.empty,
                    body: successHtml,
                  } as const;
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("does not reuse failed transaction document loads", async () => {
    let callCount = 0;

    const program = Effect.gen(function* () {
      const transactionId = yield* TwitterTransactionId;
      return yield* transactionId.headerFor({
        method: "GET",
        url: "https://api.x.com/graphql/test/Failure",
      });
    }).pipe(
      Effect.provide(
        transactionIdLayer(() =>
          Effect.suspend(() => {
            callCount += 1;
            return Effect.fail(makeHttpStatusError("TransactionIdHome"));
          }),
        ),
      ),
    );

    await expect(Effect.runPromise(program)).rejects.toMatchObject({
      _tag: "HttpStatusError",
      endpointId: "TransactionIdHome",
    });
    await expect(Effect.runPromise(program)).rejects.toMatchObject({
      _tag: "HttpStatusError",
      endpointId: "TransactionIdHome",
    });

    expect(callCount).toBe(2);
  });

  it("refetches the transaction document when restored cookies bump the signed-in session revision", async () => {
    let callCount = 0;

    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const requestAuth = yield* UserRequestAuth;

        yield* auth.restoreCookies(restoredSessionCookies);
        yield* requestAuth.headersFor(endpointRegistry.searchProfiles("Twitter", 1));
        expect(callCount).toBe(1);

        yield* auth.restoreCookies(otherRestoredSessionCookies);
        yield* requestAuth.headersFor(endpointRegistry.searchProfiles("Twitter", 1));

        expect(callCount).toBe(2);
      }).pipe(Effect.provide(liveUserAuthLayer(() =>
        Effect.sync(() => {
          callCount += 1;
          return {
            headers: emptyHeaders,
            cookies: Cookies.empty,
            body: successHtml,
          } as const;
        }),
      ))),
    );
  });

  it("reuses trends within TTL and refreshes them after expiry", async () => {
    let callCount = 0;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const trends = yield* TwitterTrends;

          yield* auth.restoreCookies(restoredSessionCookies);

          const first = yield* trends.getTrends();
          const second = yield* trends.getTrends();

          expect(first).toEqual(["Effect", "TwitterScraper"]);
          expect(second).toEqual(["Effect", "TwitterScraper"]);
          expect(callCount).toBe(1);

          yield* TestClock.adjust("30001 millis");

          const third = yield* trends.getTrends();

          expect(third).toEqual(["Effect", "TwitterScraper"]);
          expect(callCount).toBe(2);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              TestClock.layer(),
              trendsLayer(() =>
                Effect.sync(() => {
                  callCount += 1;
                  return {
                    headers: emptyHeaders,
                    cookies: Cookies.empty,
                    body: trendsFixture,
                  } as const;
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("does not reuse failed trends lookups", async () => {
    let callCount = 0;

    const program = Effect.gen(function* () {
      const auth = yield* UserAuth;
      const trends = yield* TwitterTrends;

      yield* auth.restoreCookies(restoredSessionCookies);
      return yield* trends.getTrends();
    }).pipe(
      Effect.provide(
        trendsLayer(() =>
          Effect.suspend(() => {
            callCount += 1;
            return Effect.fail(makeHttpStatusError("Trends"));
          }),
        ),
      ),
    );

    await expect(Effect.runPromise(program)).rejects.toMatchObject({
      _tag: "HttpStatusError",
      endpointId: "Trends",
    });
    await expect(Effect.runPromise(program)).rejects.toMatchObject({
      _tag: "HttpStatusError",
      endpointId: "Trends",
    });

    expect(callCount).toBe(2);
  });

  it("refetches trends when restored cookies bump the signed-in session revision", async () => {
    let callCount = 0;

    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const trends = yield* TwitterTrends;

        yield* auth.restoreCookies(restoredSessionCookies);
        expect(yield* trends.getTrends()).toEqual(["Effect", "TwitterScraper"]);
        expect(callCount).toBe(1);

        yield* auth.restoreCookies(otherRestoredSessionCookies);
        expect(yield* trends.getTrends()).toEqual(["Effect", "TwitterScraper"]);
        expect(callCount).toBe(2);
      }).pipe(
        Effect.provide(
          trendsLayer(() =>
            Effect.sync(() => {
              callCount += 1;
              return {
                headers: emptyHeaders,
                cookies: Cookies.empty,
                body: trendsFixture,
              } as const;
            }),
          ),
        ),
      ),
    );
  });
});
