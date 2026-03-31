import { Effect, Layer, Ref, Stream } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect, it } from "vitest";

import {
  CookieManager,
  endpointRegistry,
  httpRequestKey,
  TwitterConfig,
  TwitterHttpClient,
  TwitterSearch,
  UserAuth,
  UserScraperStrategy,
} from "../index";
import type { HttpScript } from "../src/http";
import { createStrategyExecute } from "../src/strategy";
import { TwitterTransactionId } from "../src/transaction-id";
import { TwitterXpff } from "../src/xpff";
import {
  searchProfilesPageOneFixture,
  searchProfilesPageTwoFixture,
} from "./fixtures";

const userAuthTestLayer = (initialCookies: Readonly<Record<string, string>> = {}) =>
  UserAuth.liveLayer.pipe(
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterConfig.layer),
  );

const searchTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
) =>
  TwitterSearch.layer.pipe(
    Layer.provideMerge(UserScraperStrategy.standardLayer),
    Layer.provideMerge(TwitterXpff.testLayer()),
    Layer.provideMerge(TwitterTransactionId.testLayer()),
    Layer.provideMerge(UserAuth.liveLayer),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.layer),
  );

describe("Slice 2 authenticated session", () => {
  it("restores a logged-in session from serialized cookies", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;

        expect(yield* auth.isLoggedIn()).toBe(false);

        yield* auth.restoreCookies([
          "ct0=csrf-token; Path=/; Domain=x.com",
          "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
        ]);

        const serializedCookies = yield* auth.serializeCookies;

        expect(yield* auth.isLoggedIn()).toBe(true);
        expect(serializedCookies).toHaveLength(2);
        expect(serializedCookies.join("\n")).toContain("auth_token=session-token");
        expect(serializedCookies.join("\n")).toContain("ct0=csrf-token");
      }).pipe(Effect.provide(userAuthTestLayer())),
    );
  });

  it("builds authenticated headers from restored cookies", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;

        yield* auth.restoreCookies([
          "ct0=csrf-token; Path=/; Domain=x.com",
          "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
        ]);

        const headers = yield* auth.headersFor({
          family: "graphql",
          bearerToken: "secondary",
        });

        expect(headers.cookie).toContain("ct0=csrf-token");
        expect(headers.cookie).toContain("auth_token=session-token");
        expect(headers["x-csrf-token"]).toBe("csrf-token");
        expect(headers["x-twitter-auth-type"]).toBe("OAuth2Session");
        expect(headers["x-twitter-active-user"]).toBe("yes");
        expect(headers["x-twitter-client-language"]).toBe("en");
      }).pipe(Effect.provide(userAuthTestLayer())),
    );
  });
});

describe("Slice 2 authenticated search", () => {
  it("adds a transaction id header to authenticated requests", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const capturedHeaders = yield* Ref.make<
          Readonly<Record<string, string>> | undefined
        >(undefined);

        const execute = createStrategyExecute(
          {
            headersFor: () =>
              Effect.succeed({
                authorization: "Bearer test-token",
              }),
            invalidate: Effect.void,
          },
          {
            applySetCookies: () => Effect.void,
          },
          HttpClient.make((request) =>
            Effect.gen(function* () {
              yield* Ref.set(capturedHeaders, request.headers);
              return HttpClientResponse.fromWeb(
                request,
                new Response("{}", {
                  status: 200,
                  headers: {
                    "content-type": "application/json",
                  },
                }),
              );
            }),
          ),
          () =>
            Effect.succeed({
              "x-client-transaction-id": "test-transaction-id",
              "x-xp-forwarded-for": "test-xpff",
            }),
        );

        yield* execute({
          endpointId: "SearchProfiles",
          family: "graphql",
          authRequirement: "user",
          bearerToken: "secondary",
          rateLimitBucket: "searchProfiles",
          request: HttpClientRequest.get("https://api.x.com/graphql/test/SearchProfiles"),
          decode: () => ({ ok: true }),
        });

        const headers = yield* Ref.get(capturedHeaders);
        expect(headers?.authorization).toBe("Bearer test-token");
        expect(headers?.["x-client-transaction-id"]).toBe(
          "test-transaction-id",
        );
        expect(headers?.["x-xp-forwarded-for"]).toBe("test-xpff");
      }),
    );
  });

  it("derives an xpff header when a guest id cookie is present", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const xpff = yield* TwitterXpff;
        const headers = yield* xpff.headerFor();

        expect(headers["x-xp-forwarded-for"]).toMatch(/^[0-9a-f]+$/);
        expect(headers["x-xp-forwarded-for"]?.length).toBeGreaterThan(20);
      }).pipe(
        Effect.provide(
          TwitterXpff.liveLayer.pipe(
            Layer.provideMerge(
              CookieManager.testLayer({
                guest_id: "v1%3A123456789012345678",
              }),
            ),
          ),
        ),
      ),
    );
  });

  it("rejects profile search when no authenticated session is restored", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const search = yield* TwitterSearch;
          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }).pipe(Effect.provide(searchTestLayer({}))),
      ),
    ).rejects.toMatchObject({
      _tag: "AuthenticationError",
    });
  });

  it("searches profiles through the full layer stack with restored cookies", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const search = yield* TwitterSearch;

        yield* auth.restoreCookies([
          "ct0=csrf-token; Path=/; Domain=x.com",
          "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
        ]);

        const profiles = yield* Stream.runCollect(
          search.searchProfiles("Twitter", { limit: 3 }),
        );

        expect(profiles.map((profile) => profile.username)).toEqual([
          "twitterdev",
          "twitterapi",
          "twittereng",
        ]);
        expect(profiles[0]?.website).toBe("https://developer.x.com");
      }).pipe(
        Effect.provide(
          searchTestLayer({
            [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 3).request)]:
              [{ status: 200, json: searchProfilesPageOneFixture }],
            [httpRequestKey(
              endpointRegistry.searchProfiles(
                "Twitter",
                1,
                "search-cursor-1",
              ).request,
            )]: [{ status: 200, json: searchProfilesPageTwoFixture }],
          }),
        ),
      ),
    );
  });
});
