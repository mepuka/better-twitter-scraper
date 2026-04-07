import { Effect, Layer } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import { TwitterConfig, TwitterHttpClient } from "../index";
import {
  getFallbackQueryIds,
  mergeKnownQueryIds,
  resolveRequestQueryIds,
} from "../src/endpoint-catalog";
import {
  extractEndpointsFromBundle,
  extractScriptUrls,
  TwitterEndpointDiscovery,
} from "../src/endpoint-discovery";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";

// ---------------------------------------------------------------------------
// Pure unit tests — no Effect runtime needed
// ---------------------------------------------------------------------------

describe("extractScriptUrls", () => {
  it("extracts client-web bundle URLs from HTML", () => {
    const html = `
      <html>
      <head>
        <script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js" nonce="xyz"></script>
        <script src="https://abs.twimg.com/responsive-web/client-web/vendor.def456.js" nonce="xyz"></script>
        <script src="https://abs.twimg.com/some-other/analytics.js" nonce="xyz"></script>
      </head>
      </html>
    `;

    const urls = extractScriptUrls(html);

    expect(urls).toEqual([
      "https://abs.twimg.com/responsive-web/client-web/main.abc123.js",
      "https://abs.twimg.com/responsive-web/client-web/vendor.def456.js",
    ]);
  });

  it("returns empty array when no matching scripts found", () => {
    const html = `<html><head><script src="/analytics.js"></script></head></html>`;
    expect(extractScriptUrls(html)).toEqual([]);
  });

  it("handles HTML with no script tags", () => {
    expect(extractScriptUrls("<html><body>Hello</body></html>")).toEqual([]);
  });
});

describe("extractEndpointsFromBundle", () => {
  it("extracts endpoints from minified JS with full format", () => {
    const js = `
      e.exports={queryId:"AWbeRIdkLtqTRN7yL_H8yw",operationName:"UserByScreenName",operationType:"query"}
      ,{queryId:"N2tFDY-MlrLxXJ9F_ZxJGA",operationName:"UserTweets",operationType:"query"}
      ,{queryId:"YCNdW_ZytXfV9YR3cJK9kw",operationName:"TweetDetail",operationType:"query"}
    `;

    const result = extractEndpointsFromBundle(js);

    expect(result.get("UserByScreenName")).toBe("AWbeRIdkLtqTRN7yL_H8yw");
    expect(result.get("UserTweets")).toBe("N2tFDY-MlrLxXJ9F_ZxJGA");
    expect(result.get("TweetDetail")).toBe("YCNdW_ZytXfV9YR3cJK9kw");
    expect(result.size).toBe(3);
  });

  it("extracts endpoints from shorter queryId/operationName format", () => {
    const js = `queryId:"NEWID123",operationName:"UserByScreenName"`;

    const result = extractEndpointsFromBundle(js);

    expect(result.get("UserByScreenName")).toBe("NEWID123");
  });

  it("returns empty map from JS with no endpoints", () => {
    const js = `var x = 42; function foo() { return "bar"; }`;
    expect(extractEndpointsFromBundle(js).size).toBe(0);
  });

  it("handles multiple endpoints across a large bundle", () => {
    const js = Array.from({ length: 50 }, (_, i) =>
      `{queryId:"id_${i}",operationName:"Op${i}",operationType:"query"}`,
    ).join(",");

    const result = extractEndpointsFromBundle(js);
    expect(result.size).toBe(50);
    expect(result.get("Op0")).toBe("id_0");
    expect(result.get("Op49")).toBe("id_49");
  });
});

describe("mergeKnownQueryIds / resolveRequestQueryIds", () => {
  it("replaces known query IDs and ignores unknown ones", () => {
    const originalIds = getFallbackQueryIds();

    const discovered = new Map([
      ["UserByScreenName", "NEWID_UserByScreenName"],
      ["TweetDetail", "NEWID_TweetDetail"],
      ["SomeUnknownEndpoint", "NEWID_Unknown"],
    ]);

    const ids = mergeKnownQueryIds(originalIds, discovered);

    expect(ids.get("UserByScreenName")).toBe("NEWID_UserByScreenName");
    expect(ids.get("TweetDetail")).toBe("NEWID_TweetDetail");
    expect(ids.has("SomeUnknownEndpoint")).toBe(false);
    expect(ids.get("UserTweets")).toBe(originalIds.get("UserTweets"));
  });

  it("reflects updated IDs in endpointRegistry URLs", () => {
    const ids = mergeKnownQueryIds(
      getFallbackQueryIds(),
      new Map([["UserByScreenName", "REPLACED_HASH"]]),
    );

    const request = resolveRequestQueryIds(
      endpointRegistry.userByScreenName("testuser"),
      ids,
    );
    expect(request.url).toContain("/graphql/REPLACED_HASH/UserByScreenName");
  });
});

// ---------------------------------------------------------------------------
// Integration test — TwitterEndpointDiscovery service with scripted HTTP
// ---------------------------------------------------------------------------

describe("TwitterEndpointDiscovery service", () => {
  const bundleJs = [
    '{queryId:"disc_ABC",operationName:"UserByScreenName",operationType:"query"}',
    '{queryId:"disc_DEF",operationName:"TweetDetail",operationType:"query"}',
    '{queryId:"disc_GHI",operationName:"Followers",operationType:"query"}',
  ].join(",");

  const homeHtml = `
    <html>
    <head>
      <script src="https://abs.twimg.com/responsive-web/client-web/main.hash1.js" nonce="abc"></script>
    </head>
    <body></body>
    </html>
  `;

  // Note: the scripted HTTP layer normalizes URLs via the platform URL parser,
  // so "https://x.com" becomes "https://x.com/" with a trailing slash.
  const makeDiscoveryScript = (): HttpScript => ({
    ["GET https://x.com/"]: [
      { status: 200, bodyText: homeHtml },
    ],
    ["GET https://abs.twimg.com/responsive-web/client-web/main.hash1.js"]: [
      { status: 200, bodyText: bundleJs },
    ],
  });

  const discoveryTestLayer = (script: HttpScript) =>
    TwitterEndpointDiscovery.liveLayer.pipe(
      Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
      Layer.provideMerge(TwitterConfig.testLayer()),
    );

  it.effect("discovers query IDs from scripted x.com and JS bundles", () =>
    Effect.gen(function* () {
      const discovery = yield* TwitterEndpointDiscovery;
      const ids = yield* discovery.discoverQueryIds();

      expect(ids.get("UserByScreenName")).toBe("disc_ABC");
      expect(ids.get("TweetDetail")).toBe("disc_DEF");
      expect(ids.get("Followers")).toBe("disc_GHI");
      expect(ids.size).toBe(3);
    }).pipe(Effect.provide(discoveryTestLayer(makeDiscoveryScript()))),
  );

  it.effect("returns empty map when no scripts found in HTML", () => {
    const script: HttpScript = {
      ["GET https://x.com/"]: [
        { status: 200, bodyText: "<html><body>No scripts</body></html>" },
      ],
    };

    return Effect.gen(function* () {
      const discovery = yield* TwitterEndpointDiscovery;
      const ids = yield* discovery.discoverQueryIds();

      expect(ids.size).toBe(0);
    }).pipe(Effect.provide(discoveryTestLayer(script)));
  });

  it.effect("gracefully handles a bundle fetch failure", () => {
    const script: HttpScript = {
      ["GET https://x.com/"]: [
        { status: 200, bodyText: homeHtml },
      ],
      ["GET https://abs.twimg.com/responsive-web/client-web/main.hash1.js"]: [
        { status: 500, bodyText: "Internal Server Error" },
      ],
    };

    return Effect.gen(function* () {
      const discovery = yield* TwitterEndpointDiscovery;
      // Bundle fetch fails -> orElseSucceed("") -> no endpoints extracted
      // But the overall discovery doesn't fail — it returns what it could find
      const ids = yield* discovery.discoverQueryIds();
      expect(ids.size).toBe(0);
    }).pipe(Effect.provide(discoveryTestLayer(script)));
  });

  it.effect("test layer returns provided query IDs", () => {
    const testIds = new Map([
      ["UserByScreenName", "test_id_1"],
      ["TweetDetail", "test_id_2"],
    ]);

    return Effect.gen(function* () {
      const discovery = yield* TwitterEndpointDiscovery;
      const ids = yield* discovery.discoverQueryIds();

      expect(ids.get("UserByScreenName")).toBe("test_id_1");
      expect(ids.get("TweetDetail")).toBe("test_id_2");
    }).pipe(Effect.provide(TwitterEndpointDiscovery.testLayer(testIds)));
  });

  it.effect("disabled layer returns empty map", () =>
    Effect.gen(function* () {
      const discovery = yield* TwitterEndpointDiscovery;
      const ids = yield* discovery.discoverQueryIds();

      expect(ids.size).toBe(0);
    }).pipe(Effect.provide(TwitterEndpointDiscovery.disabledLayer)),
  );
});
