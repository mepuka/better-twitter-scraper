import { Effect, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  CookieManager,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterSearch,
  UserAuth,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";
import { httpRequestKey } from "../src/request";
import { RequestAuth } from "../src/request-auth";
import * as WebCrypto from "../src/web-crypto";
import { TwitterXpff } from "../src/xpff";
import {
  searchProfilesPageOneFixture,
  searchProfilesPageTwoFixture,
} from "./fixtures";

const restoredSessionCookies = [
  "ct0=csrf-token; Path=/; Domain=x.com",
  "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
] as const;

const userAuthTestLayer = (
  initialCookies: Readonly<Record<string, string>> = {},
  options: {
    readonly transactionId?: string;
    readonly xpff?: string;
  } = {},
) =>
  UserAuth.testLayer(options).pipe(
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const searchTestLayer = (
  script: HttpScript,
  initialCookies: Readonly<Record<string, string>> = {},
) =>
  TwitterSearch.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer(initialCookies)),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

describe("Slice 2 authenticated session", () => {
  it("restores a logged-in session from serialized cookies", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;

        expect(yield* auth.isLoggedIn()).toBe(false);

        yield* auth.restoreCookies(restoredSessionCookies);

        const serializedCookies = yield* auth.serializeCookies;

        expect(yield* auth.isLoggedIn()).toBe(true);
        expect(serializedCookies).toHaveLength(2);
        expect(serializedCookies.join("\n")).toContain("auth_token=session-token");
        expect(serializedCookies.join("\n")).toContain("ct0=csrf-token");
      }).pipe(Effect.provide(userAuthTestLayer())),
    );
  });

  it("builds authenticated request headers from restored cookies", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* UserAuth;
        const requestAuth = yield* RequestAuth;

        yield* auth.restoreCookies(restoredSessionCookies);

        const headers = yield* requestAuth.headersFor(
          endpointRegistry.searchProfiles("Twitter", 2),
        );

        expect(headers.cookie).toContain("ct0=csrf-token");
        expect(headers.cookie).toContain("auth_token=session-token");
        expect(headers["x-csrf-token"]).toBe("csrf-token");
        expect(headers["x-twitter-auth-type"]).toBe("OAuth2Session");
        expect(headers["x-twitter-active-user"]).toBe("yes");
        expect(headers["x-twitter-client-language"]).toBe("en");
        expect(headers["x-client-transaction-id"]).toBe("test-transaction-id");
        expect(headers["x-xp-forwarded-for"]).toBe("test-xpff");
      }).pipe(
        Effect.provide(
          userAuthTestLayer(
            {},
            {
              transactionId: "test-transaction-id",
              xpff: "test-xpff",
            },
          ),
        ),
      ),
    );
  });
});

describe("Slice 2 authenticated search", () => {
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

  it("omits an xpff header when no guest id cookie is present", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const xpff = yield* TwitterXpff;
        const headers = yield* xpff.headerFor();

        expect(headers).toEqual({});
      }).pipe(
        Effect.provide(
          TwitterXpff.liveLayer.pipe(
            Layer.provideMerge(CookieManager.testLayer()),
          ),
        ),
      ),
    );
  });

  it("maps crypto helper failures to an xpff invalid response error", async () => {
    const randomBytesSpy = vi
      .spyOn(WebCrypto, "randomBytes")
      .mockReturnValue(
        Effect.fail(
          new WebCrypto.CryptoOperationError({
            operation: "randomBytes",
            reason: "xpff entropy failed",
          }),
        ),
      );

    try {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const xpff = yield* TwitterXpff;
            return yield* xpff.headerFor();
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
        ),
      ).rejects.toMatchObject({
        _tag: "InvalidResponseError",
        endpointId: "XpffHeader",
        reason: "xpff entropy failed",
      });
    } finally {
      randomBytesSpy.mockRestore();
    }
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

        yield* auth.restoreCookies(restoredSessionCookies);

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
            [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 3))]: [
              { status: 200, json: searchProfilesPageOneFixture },
            ],
            [httpRequestKey(
              endpointRegistry.searchProfiles("Twitter", 1, "search-cursor-1"),
            )]: [{ status: 200, json: searchProfilesPageTwoFixture }],
          }),
        ),
      ),
    );
  });
});

describe("Slice 3A authenticated failure classification", () => {
  it("maps 401 search failures to AuthenticationError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }).pipe(
          Effect.provide(
            searchTestLayer({
              [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
                { status: 401, bodyText: "not logged in" },
              ],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "AuthenticationError",
      reason:
        "SearchProfiles rejected the restored authenticated session with HTTP 401.",
    });
  });

  it("maps search rate limits to RateLimitError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }).pipe(
          Effect.provide(
            searchTestLayer({
              [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
                {
                  status: 429,
                  headers: {
                    "x-rate-limit-limit": "50",
                    "x-rate-limit-remaining": "0",
                    "x-rate-limit-reset": "1712349999",
                  },
                  bodyText: "too many searches",
                },
              ],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RateLimitError",
      endpointId: "SearchProfiles",
      bucket: "searchProfiles",
      status: 429,
      body: "too many searches",
      limit: 50,
      remaining: 0,
      reset: 1712349999,
    });
  });

  it("maps a blank search 404 to BotDetectionError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }).pipe(
          Effect.provide(
            searchTestLayer({
              [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
                { status: 404, bodyText: "" },
              ],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "BotDetectionError",
      endpointId: "SearchProfiles",
      reason: "empty_404",
    });
  });

  it("treats a structurally drifted search payload as InvalidResponseError", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* UserAuth;
          const search = yield* TwitterSearch;

          yield* auth.restoreCookies(restoredSessionCookies);

          return yield* Stream.runCollect(
            search.searchProfiles("Twitter", { limit: 2 }),
          );
        }).pipe(
          Effect.provide(
            searchTestLayer({
              [httpRequestKey(endpointRegistry.searchProfiles("Twitter", 2))]: [
                { status: 200, json: { data: { search_by_raw_query: {} } } },
              ],
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "InvalidResponseError",
      endpointId: "SearchProfiles",
    });
  });
});
