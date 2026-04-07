import { Cache, Duration, Effect, Exit, Layer, ServiceMap } from "effect";

import {
  CHROME_SEC_CH_UA,
  CHROME_SEC_CH_UA_MOBILE,
  CHROME_SEC_CH_UA_PLATFORM,
} from "./chrome-fingerprint";
import { TwitterConfig } from "./config";
import {
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import { TwitterHttpClient } from "./http";
import type { PreparedApiRequest } from "./request";

type EndpointDiscoveryError =
  | HttpStatusError
  | InvalidResponseError
  | TransportError;

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Matches GraphQL endpoint definitions in minified JS bundles.
 * Twitter's bundles contain entries like:
 *   {queryId:"AWbeRIdkLtqTRN7yL_H8yw",operationName:"UserByScreenName",operationType:"query"}
 */
const ENDPOINT_PATTERNS = [
  /\{queryId:"([^"]+)",operationName:"([^"]+)",operationType:"([^"]+)"\}/g,
  /queryId:"([^"]+)",operationName:"([^"]+)"/g,
] as const;

const SCRIPT_SRC_PATTERN = /<script[^>]+src="([^"]+)"[^>]*>/g;

const navigationHeaders = (userAgent: string): Readonly<Record<string, string>> => ({
  "user-agent": userAgent,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "sec-ch-ua": CHROME_SEC_CH_UA,
  "sec-ch-ua-mobile": CHROME_SEC_CH_UA_MOBILE,
  "sec-ch-ua-platform": CHROME_SEC_CH_UA_PLATFORM,
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
});

const scriptFetchHeaders = (userAgent: string): Readonly<Record<string, string>> => ({
  "user-agent": userAgent,
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": CHROME_SEC_CH_UA,
  "sec-ch-ua-mobile": CHROME_SEC_CH_UA_MOBILE,
  "sec-ch-ua-platform": CHROME_SEC_CH_UA_PLATFORM,
  "sec-fetch-dest": "script",
  "sec-fetch-mode": "no-cors",
  "sec-fetch-site": "cross-site",
  referer: "https://x.com/",
});

const discoveryError = (reason: string) =>
  new InvalidResponseError({
    endpointId: "EndpointDiscovery",
    reason,
  });

const pageVisitRequest = (
  headers: Readonly<Record<string, string>>,
  url: string,
  endpointId: string,
): PreparedApiRequest<string> => ({
  endpointId,
  family: "pageVisit",
  authRequirement: "guest",
  bearerToken: "secondary",
  rateLimitBucket: "generic",
  method: "GET",
  url,
  headers,
  body: { _tag: "none" },
  responseKind: "html",
  decode: (value) => {
    if (typeof value !== "string") {
      throw discoveryError("Expected a text response.");
    }
    return value;
  },
});

/** Extract JS bundle URLs from x.com HTML. */
export const extractScriptUrls = (html: string): readonly string[] => {
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(SCRIPT_SRC_PATTERN.source, SCRIPT_SRC_PATTERN.flags);

  while ((match = pattern.exec(html)) !== null) {
    const src = match[1];
    if (src && (src.includes("client-web") || src.includes("responsive-web"))) {
      urls.push(src);
    }
  }

  return urls;
};

/** Extract queryId/operationName pairs from a JS bundle string. */
export const extractEndpointsFromBundle = (
  js: string,
): ReadonlyMap<string, string> => {
  const result = new Map<string, string>();

  for (const pattern of ENDPOINT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(js)) !== null) {
      const queryId = match[1];
      const operationName = match[2];
      if (queryId && operationName) {
        result.set(operationName, queryId);
      }
    }
  }

  return result;
};

export class TwitterEndpointDiscovery extends ServiceMap.Service<
  TwitterEndpointDiscovery,
  {
    readonly discoverQueryIds: () => Effect.Effect<
      ReadonlyMap<string, string>,
      EndpointDiscoveryError
    >;
    readonly refreshQueryIds: () => Effect.Effect<
      ReadonlyMap<string, string>,
      EndpointDiscoveryError
    >;
  }
>()("@better-twitter-scraper/TwitterEndpointDiscovery") {
  static readonly disabledLayer = Layer.succeed(TwitterEndpointDiscovery, {
    discoverQueryIds: () => Effect.succeed(new Map()),
    refreshQueryIds: () => Effect.succeed(new Map()),
  });

  static testLayer(
    queryIds: ReadonlyMap<string, string> = new Map(),
  ) {
    return Layer.succeed(TwitterEndpointDiscovery, {
      discoverQueryIds: () => Effect.succeed(queryIds),
      refreshQueryIds: () => Effect.succeed(queryIds),
    });
  }

  static readonly liveLayer = Layer.effect(
    TwitterEndpointDiscovery,
    Effect.gen(function* () {
      const http = yield* TwitterHttpClient;
      const config = yield* TwitterConfig;

      const fetchText = Effect.fn("TwitterEndpointDiscovery.fetchText")(
        function* (request: PreparedApiRequest<string>) {
          const response = yield* http.execute(request);
          if (typeof response.body !== "string") {
            return yield* discoveryError("Expected a text response.");
          }
          return response.body;
        },
      );

      const loadQueryIds = Effect.fn("TwitterEndpointDiscovery.loadQueryIds")(
        function* () {
          const headers = navigationHeaders(config.userAgent);
          const homeHtml = yield* fetchText(
            pageVisitRequest(headers, "https://x.com", "EndpointDiscoveryHome"),
          );

          const scriptUrls = extractScriptUrls(homeHtml);

          if (scriptUrls.length === 0) {
            return new Map<string, string>();
          }

          const allEndpoints = new Map<string, string>();
          const fetchHeaders = scriptFetchHeaders(config.userAgent);

          for (const url of scriptUrls) {
            const absoluteUrl = url.startsWith("http")
              ? url
              : url.startsWith("//")
                ? `https:${url}`
                : `https://x.com${url}`;

            const bundleJs = yield* fetchText(
              pageVisitRequest(
                fetchHeaders,
                absoluteUrl,
                "EndpointDiscoveryBundle",
              ),
            ).pipe(Effect.orElseSucceed(() => ""));

            if (bundleJs) {
              const endpoints = extractEndpointsFromBundle(bundleJs);
              for (const [name, id] of endpoints) {
                allEndpoints.set(name, id);
              }
            }
          }

          return allEndpoints as ReadonlyMap<string, string>;
        },
      );

      const queryIdCache = yield* Cache.makeWith<
        0,
        ReadonlyMap<string, string>,
        EndpointDiscoveryError
      >({
        capacity: 1,
        lookup: () => loadQueryIds(),
        timeToLive: (exit) =>
          Exit.isSuccess(exit)
            ? Duration.millis(DISCOVERY_CACHE_TTL_MS)
            : Duration.millis(0),
      });

      const discoverQueryIds = Effect.fn(
        "TwitterEndpointDiscovery.discoverQueryIds",
      )(function* () {
        return yield* Cache.get(queryIdCache, 0);
      });

      const refreshQueryIds = Effect.fn(
        "TwitterEndpointDiscovery.refreshQueryIds",
      )(function* () {
        return yield* loadQueryIds();
      });

      return { discoverQueryIds, refreshQueryIds };
    }),
  );
}
