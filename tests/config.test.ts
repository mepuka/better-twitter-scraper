import { Effect, Redacted } from "effect";
import { it } from "@effect/vitest";
import { afterEach, describe, expect } from "vitest";

import { TwitterConfig } from "../index";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("TwitterConfig", () => {
  it.effect("loads required env config and keeps bearer tokens redacted", () => {
    process.env.TWITTER_BEARER_TOKEN = "env-default-token";
    process.env.TWITTER_BEARER_TOKEN_SECONDARY = "env-secondary-token";

    return Effect.gen(function* () {
      const config = yield* TwitterConfig;

      expect(Redacted.value(config.bearerTokens.default)).toBe("env-default-token");
      expect(Redacted.value(config.bearerTokens.secondary)).toBe(
        "env-secondary-token",
      );
      expect(String(config.bearerTokens.default)).toContain("redacted");
      expect(config.timeline.defaultLimit).toBe(20);
      expect(config.search.maxPageSize).toBe(50);
    }).pipe(Effect.provide(TwitterConfig.fromEnvLayer));
  });

  it.effect("keeps the production default pagination jitter enabled", () =>
    Effect.gen(function* () {
      const config = yield* TwitterConfig;

      expect(config.pagination.jitterMs).toBe(500);
    }).pipe(Effect.provide(TwitterConfig.defaultLayer())),
  );

  it.effect("supports deterministic overrides through the test layer", () =>
    Effect.gen(function* () {
      const config = yield* TwitterConfig;

      expect(config.proxyUrl).toBe("http://localhost:9999");
      expect(config.timeline.defaultLimit).toBe(5);
      expect(config.timeline.maxPageSize).toBe(40);
      expect(config.search.maxPageSize).toBe(10);
      expect(config.pagination.jitterMs).toBe(0);
    }).pipe(
      Effect.provide(
        TwitterConfig.testLayer({
          proxyUrl: "http://localhost:9999",
          timeline: {
            defaultLimit: 5,
          },
          search: {
            maxPageSize: 10,
          },
        }),
      ),
    ),
  );
});
