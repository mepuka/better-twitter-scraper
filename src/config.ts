import { Config, Duration, Effect, Layer, Option, Redacted, ServiceMap } from "effect";

import { CHROME_USER_AGENT } from "./chrome-fingerprint";

const DEFAULT_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAAFQODgEAAAAAVHTp76lzh3rFzcHbmHVvQxYYpTw%3DckAlMINMjmCwxUcaXbAN4XqJVdgMJaHqNOFgPMK0zN1qLqLQCF";
const DEFAULT_SECONDARY_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const DEFAULT_GUEST_ACTIVATE_URL = "https://api.x.com/1.1/guest/activate.json";

export interface TwitterConfigShape {
  readonly bearerTokens: {
    readonly default: Redacted.Redacted<string>;
    readonly secondary: Redacted.Redacted<string>;
  };
  readonly urls: {
    readonly guestActivate: string;
  };
  readonly proxyUrl?: string;
  readonly userAgent: string;
  readonly requestTimeout: Duration.Duration;
  readonly guestTokenTtl: Duration.Duration;
  readonly timeline: {
    readonly defaultLimit: number;
    readonly maxPageSize: number;
    readonly includePromotedContent: boolean;
  };
  readonly search: {
    readonly defaultLimit: number;
    readonly maxPageSize: number;
  };
  readonly pagination: {
    readonly jitterMs: number;
  };
  readonly strategy: {
    readonly retryLimit: number;
  };
}

const makeConfig = (
  overrides: Partial<{
    readonly bearerTokens: Partial<TwitterConfigShape["bearerTokens"]>;
    readonly guestTokenTtl: Duration.Duration;
    readonly pagination: Partial<TwitterConfigShape["pagination"]>;
    readonly proxyUrl?: string;
    readonly requestTimeout: Duration.Duration;
    readonly search: Partial<TwitterConfigShape["search"]>;
    readonly strategy: Partial<TwitterConfigShape["strategy"]>;
    readonly timeline: Partial<TwitterConfigShape["timeline"]>;
    readonly urls: Partial<TwitterConfigShape["urls"]>;
    readonly userAgent: string;
  }> = {},
): TwitterConfigShape => ({
  bearerTokens: {
    default:
      overrides.bearerTokens?.default ?? Redacted.make(DEFAULT_BEARER_TOKEN),
    secondary:
      overrides.bearerTokens?.secondary ??
      Redacted.make(DEFAULT_SECONDARY_BEARER_TOKEN),
  },
  urls: {
    guestActivate:
      overrides.urls?.guestActivate ?? DEFAULT_GUEST_ACTIVATE_URL,
  },
  ...(overrides.proxyUrl ? { proxyUrl: overrides.proxyUrl } : {}),
  userAgent: overrides.userAgent ?? CHROME_USER_AGENT,
  requestTimeout: overrides.requestTimeout ?? Duration.millis(30_000),
  guestTokenTtl: overrides.guestTokenTtl ?? Duration.millis(10_800_000),
  timeline: {
    defaultLimit: overrides.timeline?.defaultLimit ?? 20,
    maxPageSize: overrides.timeline?.maxPageSize ?? 40,
    includePromotedContent:
      overrides.timeline?.includePromotedContent ?? false,
  },
  pagination: {
    jitterMs: overrides.pagination?.jitterMs ?? 500,
  },
  search: {
    defaultLimit: overrides.search?.defaultLimit ?? 20,
    maxPageSize: overrides.search?.maxPageSize ?? 50,
  },
  strategy: {
    retryLimit: overrides.strategy?.retryLimit ?? 1,
  },
});

export class TwitterConfig extends ServiceMap.Service<
  TwitterConfig,
  TwitterConfigShape
>()("@better-twitter-scraper/TwitterConfig") {
  static get fromEnvLayer() {
    return Layer.effect(
      TwitterConfig,
      Effect.gen(function* () {
        const bearerToken = yield* Config.redacted("TWITTER_BEARER_TOKEN");
        const bearerTokenSecondary = yield* Config.redacted(
          "TWITTER_BEARER_TOKEN_SECONDARY",
        );
        const guestActivateUrl = yield* Config.string(
          "TWITTER_GUEST_ACTIVATE_URL",
        ).pipe(Config.withDefault(DEFAULT_GUEST_ACTIVATE_URL));
        const guestTokenTtlMs = yield* Config.number(
          "TWITTER_GUEST_TOKEN_TTL_MS",
        ).pipe(Config.withDefault(10_800_000));
        const requestTimeoutMs = yield* Config.number(
          "TWITTER_REQUEST_TIMEOUT_MS",
        ).pipe(Config.withDefault(30_000));
        const timelineDefaultLimit = yield* Config.number(
          "TWITTER_TIMELINE_DEFAULT_LIMIT",
        ).pipe(Config.withDefault(20));
        const timelineMaxPageSize = yield* Config.number(
          "TWITTER_TIMELINE_MAX_PAGE_SIZE",
        ).pipe(Config.withDefault(40));
        const timelineIncludePromotedContent = yield* Config.boolean(
          "TWITTER_TIMELINE_INCLUDE_PROMOTED_CONTENT",
        ).pipe(Config.withDefault(false));
        const searchDefaultLimit = yield* Config.number(
          "TWITTER_SEARCH_DEFAULT_LIMIT",
        ).pipe(Config.withDefault(20));
        const searchMaxPageSize = yield* Config.number(
          "TWITTER_SEARCH_MAX_PAGE_SIZE",
        ).pipe(Config.withDefault(50));
        const userAgent = yield* Config.string("TWITTER_USER_AGENT").pipe(
          Config.withDefault(CHROME_USER_AGENT),
        );
        const paginationJitterMs = yield* Config.number(
          "TWITTER_PAGINATION_JITTER_MS",
        ).pipe(Config.withDefault(500));
        const strategyRetryLimit = yield* Config.number(
          "TWITTER_STRATEGY_RETRY_LIMIT",
        ).pipe(Config.withDefault(1));
        const proxyUrl = yield* Config.option(Config.string("TWITTER_PROXY_URL"));

        return makeConfig({
          bearerTokens: {
            default: bearerToken,
            secondary: bearerTokenSecondary,
          },
          urls: {
            guestActivate: guestActivateUrl,
          },
          ...(Option.isSome(proxyUrl) ? { proxyUrl: proxyUrl.value } : {}),
          userAgent,
          requestTimeout: Duration.millis(requestTimeoutMs),
          guestTokenTtl: Duration.millis(guestTokenTtlMs),
          timeline: {
            defaultLimit: timelineDefaultLimit,
            maxPageSize: timelineMaxPageSize,
            includePromotedContent: timelineIncludePromotedContent,
          },
          pagination: {
            jitterMs: paginationJitterMs,
          },
          search: {
            defaultLimit: searchDefaultLimit,
            maxPageSize: searchMaxPageSize,
          },
          strategy: {
            retryLimit: strategyRetryLimit,
          },
        });
      }),
    );
  }

  static defaultLayer(
    overrides: Partial<{
      readonly bearerTokens: Partial<TwitterConfigShape["bearerTokens"]>;
      readonly guestTokenTtl: Duration.Duration;
      readonly pagination: Partial<TwitterConfigShape["pagination"]>;
      readonly proxyUrl?: string;
      readonly requestTimeout: Duration.Duration;
      readonly search: Partial<TwitterConfigShape["search"]>;
      readonly strategy: Partial<TwitterConfigShape["strategy"]>;
      readonly timeline: Partial<TwitterConfigShape["timeline"]>;
      readonly urls: Partial<TwitterConfigShape["urls"]>;
      readonly userAgent: string;
    }> = {},
  ) {
    return Layer.succeed(
      TwitterConfig,
      makeConfig(overrides),
    );
  }

  static testLayer(
    overrides: Partial<{
      readonly bearerTokens: Partial<TwitterConfigShape["bearerTokens"]>;
      readonly guestTokenTtl: Duration.Duration;
      readonly pagination: Partial<TwitterConfigShape["pagination"]>;
      readonly proxyUrl?: string;
      readonly requestTimeout: Duration.Duration;
      readonly search: Partial<TwitterConfigShape["search"]>;
      readonly strategy: Partial<TwitterConfigShape["strategy"]>;
      readonly timeline: Partial<TwitterConfigShape["timeline"]>;
      readonly urls: Partial<TwitterConfigShape["urls"]>;
      readonly userAgent: string;
    }> = {},
  ) {
    return Layer.succeed(
      TwitterConfig,
      makeConfig({
        ...overrides,
        pagination: { jitterMs: 0, ...overrides.pagination },
      }),
    );
  }
}
