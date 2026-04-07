import { Effect, Layer } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import {
  PooledScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterSessionState,
  TwitterTrends,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import { transportMetadataLayer } from "../src/observability";
import { httpRequestKey } from "../src/request";
import { TwitterTransactionId } from "../src/transaction-id";
import { trendsFixture } from "./fixtures";

const userCookies = (label: string) => [
  { name: "ct0", value: `csrf-${label}`, domain: ".x.com" },
  { name: "auth_token", value: `auth-${label}`, domain: ".x.com" },
] as const;

const pooledBaseLayer = PooledScraperStrategy.layer([userCookies("a")]).pipe(
  Layer.provideMerge(
    TwitterHttpClient.scriptedLayer({
      [httpRequestKey(endpointRegistry.trends())]: [
        { status: 200, json: trendsFixture },
      ],
    }),
  ),
  Layer.provideMerge(TwitterTransactionId.testLayer()),
  Layer.provideMerge(TwitterConfig.testLayer()),
  Layer.provideMerge(transportMetadataLayer("scripted")),
);

const pooledSessionStateLayer = TwitterSessionState.pooledLayer.pipe(
  Layer.provideMerge(pooledBaseLayer),
);

const pooledTrendsLayer = () =>
  TwitterTrends.layer.pipe(
    Layer.provideMerge(pooledSessionStateLayer),
    Layer.provideMerge(pooledBaseLayer),
  );

describe("Pooled trends", () => {
  it.effect("loads trends through the pooled session stack", () =>
    Effect.gen(function* () {
      const trends = yield* TwitterTrends;

      const items = yield* trends.getTrends();

      expect(items).toEqual(["Effect", "TwitterScraper"]);
    }).pipe(Effect.provide(pooledTrendsLayer())),
  );
});
