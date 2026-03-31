import { Effect, Redacted } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { TwitterConfig } from "../index";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("TwitterConfig", () => {
  it("loads required env config and keeps bearer tokens redacted", async () => {
    process.env.TWITTER_BEARER_TOKEN = "env-default-token";
    process.env.TWITTER_BEARER_TOKEN_SECONDARY = "env-secondary-token";

    const config = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* TwitterConfig;
      }).pipe(Effect.provide(TwitterConfig.fromEnvLayer)),
    );

    expect(Redacted.value(config.bearerTokens.default)).toBe("env-default-token");
    expect(Redacted.value(config.bearerTokens.secondary)).toBe(
      "env-secondary-token",
    );
    expect(String(config.bearerTokens.default)).toContain("redacted");
    expect(config.timeline.defaultLimit).toBe(20);
    expect(config.search.maxPageSize).toBe(50);
  });

  it("supports deterministic overrides through the test layer", async () => {
    const config = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* TwitterConfig;
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

    expect(config.proxyUrl).toBe("http://localhost:9999");
    expect(config.timeline.defaultLimit).toBe(5);
    expect(config.timeline.maxPageSize).toBe(40);
    expect(config.search.maxPageSize).toBe(10);
  });
});
