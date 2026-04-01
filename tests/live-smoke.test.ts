import { spawnSync } from "node:child_process";

import { Effect, Layer } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import {
  CookieManager,
  TwitterConfig,
  TwitterHttpClient,
  UserAuth,
} from "../index";
import { loadSerializedCookies } from "../src/live-auth-cookies";

const runLive = process.env.RUN_LIVE_TWITTER_SMOKE === "1";
const runAuthLive = process.env.RUN_LIVE_TWITTER_AUTH_SMOKE === "1";
const likesCanaryUserId = process.env.TWITTER_LIKES_CANARY_USER_ID;
const { cookies: serializedCookies, error: serializedCookiesError } =
  loadSerializedCookies();

const userAuthLiveLayer = UserAuth.liveLayer.pipe(
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer),
  Layer.provideMerge(TwitterConfig.testLayer()),
);

describe("Live guest smoke", () => {
  if (runLive) {
    it("loads a public profile anonymously", async () => {
      const result = spawnSync("bun", ["scripts/live-guest-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly spanNames: readonly string[];
        };
        readonly profile: {
          readonly userId?: string;
          readonly username?: string;
        };
      };

      expect(payload.profile.userId).toBeTruthy();
      expect(payload.profile.username?.toLowerCase()).toBe("nomadic_ua");
      expect(payload.observability.spanNames).toEqual(
        expect.arrayContaining([
          "ScraperStrategy.execute",
          "TwitterHttpClient.execute",
          "TwitterPublic.getProfile",
        ]),
      );
    }, 30_000);

    it("loads a public tweet timeline anonymously", async () => {
      const result = spawnSync("bun", ["scripts/live-guest-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly spanNames: readonly string[];
        };
        readonly tweets: ReadonlyArray<{
          readonly id?: string;
        }>;
      };

      expect(payload.tweets.length).toBeGreaterThan(0);
      expect(payload.tweets[0]?.id).toBeTruthy();
      expect(payload.observability.spanNames).toEqual(
        expect.arrayContaining([
          "ScraperStrategy.execute",
          "TwitterHttpClient.execute",
          "TwitterPublic.fetchTweetsPage",
        ]),
      );
    }, 30_000);

  } else {
    it.skip("loads a public profile anonymously", () => {});
    it.skip("loads a public tweet timeline anonymously", () => {});
  }
});

describe("Live authenticated smoke", () => {
  if (runAuthLive && serializedCookiesError) {
    it("fails with a clear error when TWITTER_COOKIES is malformed", () => {
      throw serializedCookiesError;
    });
  } else if (runAuthLive && serializedCookies && serializedCookies.length > 0) {
    it.effect("restores a signed-in session from cookies", () =>
      Effect.gen(function* () {
        const auth = yield* UserAuth;

        yield* auth.restoreCookies(serializedCookies);

        expect(yield* auth.isLoggedIn()).toBe(true);
      }).pipe(Effect.provide(userAuthLiveLayer)),
    { timeout: 30_000 });

    it("searches profiles with restored cookies", async () => {
      const result = spawnSync("bun", ["scripts/live-auth-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly spanNames: readonly string[];
        };
        readonly usernames: readonly string[];
      };
      expect(payload.usernames.length).toBeGreaterThan(0);
      expect(payload.usernames[0]).toBeTruthy();
      expect(payload.observability.spanNames).toEqual(
        expect.arrayContaining([
          "ScraperStrategy.execute",
          "TwitterHttpClient.execute",
          "TwitterSearch.fetchProfilesPage",
          "TwitterTransactionId.headerFor",
        ]),
      );
    }, 30_000);

    it("hosts guest and authenticated services together in one runtime", async () => {
      const result = spawnSync("bun", ["scripts/live-mixed-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly profile: {
          readonly username?: string;
        };
        readonly usernames: readonly string[];
      };

      expect(payload.profile.username?.toLowerCase()).toBe("nomadic_ua");
      expect(payload.usernames.length).toBeGreaterThan(0);
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "UserByScreenName",
            authMode: "guest",
          }),
          expect.objectContaining({
            endpointId: "SearchProfiles",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    it("loads followers through the mixed guest and authenticated runtime", async () => {
      const result = spawnSync("bun", ["scripts/live-followers-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly followers: readonly string[];
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly profile: {
          readonly userId?: string;
          readonly username?: string;
        };
      };

      expect(payload.profile.username?.toLowerCase()).toBe("nomadic_ua");
      expect(payload.profile.userId).toBeTruthy();
      expect(payload.followers.length).toBeGreaterThan(0);
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "UserByScreenName",
            authMode: "guest",
          }),
          expect.objectContaining({
            endpointId: "Followers",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    it("loads authenticated tweet detail for a thread canary", async () => {
      const result = spawnSync("bun", ["scripts/live-tweet-detail-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly focalTweetId: string;
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly threadIds: readonly string[];
        readonly tweetCount: number;
      };

      expect(payload.focalTweetId).toBe("1665602315745673217");
      expect(payload.tweetCount).toBeGreaterThan(1);
      expect(payload.threadIds.length).toBeGreaterThan(1);
      expect(payload.threadIds[0]).toBe("1665602315745673217");
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "TweetDetail",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    it("projects a root-first thread through the convenience tweet thread API", async () => {
      const result = spawnSync("bun", ["scripts/live-thread-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly conversationRootId: string;
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly replyChainIds: readonly string[];
        readonly threadIds: readonly string[];
      };

      expect(payload.threadIds.length).toBeGreaterThan(1);
      expect(payload.threadIds[0]).toBe("1665602315745673217");
      expect(payload.conversationRootId).toBe("1665602315745673217");
      expect(payload.replyChainIds).toEqual(["1665602315745673217"]);
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "TweetDetail",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    it("searches tweets with restored cookies", async () => {
      const result = spawnSync("bun", ["scripts/live-search-tweets-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly tweets: ReadonlyArray<{
          readonly id?: string;
        }>;
      };

      expect(payload.tweets.length).toBeGreaterThan(0);
      expect(payload.tweets[0]?.id).toBeTruthy();
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "SearchTweets",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    it("loads list timelines with restored cookies", async () => {
      const result = spawnSync("bun", ["scripts/live-list-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly tweets: ReadonlyArray<{
          readonly id?: string;
        }>;
      };

      expect(payload.tweets.length).toBeGreaterThan(0);
      expect(payload.tweets[0]?.id).toBeTruthy();
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "ListTweets",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    it("loads tweets-and-replies with restored cookies", async () => {
      const result = spawnSync("bun", ["scripts/live-tweets-and-replies-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly tweets: ReadonlyArray<{
          readonly id?: string;
        }>;
      };

      expect(payload.tweets.length).toBeGreaterThan(0);
      expect(payload.tweets[0]?.id).toBeTruthy();
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "UserTweetsAndReplies",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    it("loads trends with restored cookies", async () => {
      const result = spawnSync("bun", ["scripts/live-trends-smoke.ts"], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      expect({
        exitCode: result.status,
        stderr,
      }).toEqual({
        exitCode: 0,
        stderr: "",
      });

      const payload = JSON.parse(stdout) as {
        readonly observability: {
          readonly strategyCalls: ReadonlyArray<{
            readonly authMode: string;
            readonly endpointId: string;
          }>;
        };
        readonly trends: readonly string[];
      };

      expect(payload.trends.length).toBeGreaterThan(0);
      expect(payload.trends[0]).toBeTruthy();
      expect(payload.observability.strategyCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpointId: "Trends",
            authMode: "user",
          }),
        ]),
      );
    }, 30_000);

    if (likesCanaryUserId) {
      it("loads liked tweets when a likes canary user id is configured", async () => {
        const result = spawnSync("bun", ["scripts/live-liked-tweets-smoke.ts"], {
          cwd: process.cwd(),
          env: process.env,
          encoding: "utf8",
        });

        const stdout = result.stdout.trim();
        const stderr = result.stderr.trim();

        expect({
          exitCode: result.status,
          stderr,
        }).toEqual({
          exitCode: 0,
          stderr: "",
        });

        const payload = JSON.parse(stdout) as {
          readonly observability: {
            readonly strategyCalls: ReadonlyArray<{
              readonly authMode: string;
              readonly endpointId: string;
            }>;
          };
          readonly tweets: ReadonlyArray<{
            readonly id?: string;
          }>;
        };

        expect(payload.tweets.length).toBeGreaterThan(0);
        expect(payload.tweets[0]?.id).toBeTruthy();
        expect(payload.observability.strategyCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              endpointId: "Likes",
              authMode: "user",
            }),
          ]),
        );
      }, 30_000);
    } else {
      it.skip("loads liked tweets when a likes canary user id is configured", () => {});
    }
  } else {
    it.skip("restores a signed-in session from cookies", () => {});
    it.skip("searches profiles with restored cookies", () => {});
    it.skip("hosts guest and authenticated services together in one runtime", () => {});
    it.skip("loads followers through the mixed guest and authenticated runtime", () => {});
    it.skip("loads authenticated tweet detail for a thread canary", () => {});
    it.skip("projects a root-first thread through the convenience tweet thread API", () => {});
    it.skip("searches tweets with restored cookies", () => {});
    it.skip("loads list timelines with restored cookies", () => {});
    it.skip("loads tweets-and-replies with restored cookies", () => {});
    it.skip("loads trends with restored cookies", () => {});
    it.skip("loads liked tweets when a likes canary user id is configured", () => {});
  }
});
