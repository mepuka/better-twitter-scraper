import { Duration, Effect, Layer } from "effect";

import type { SerializedCookie } from "./cookies";
import { CookieManager } from "./cookies";
import { TwitterConfig } from "./config";
import { TwitterDirectMessages } from "./direct-messages";
import { TwitterEndpointDiscovery } from "./endpoint-discovery";
import { GuestAuth } from "./guest-auth";
import { TwitterHttpClient } from "./http";
import { TwitterLists } from "./lists";
import { TwitterPublic } from "./public";
import { TwitterRelationships } from "./relationships";
import { TwitterSearch } from "./search";
import { TwitterSessionState } from "./session-state";
import { SignedInSessionRevision } from "./signed-in-session-revision";
import { ScraperStrategy } from "./strategy";
import { TwitterTrends } from "./trends";
import { TwitterTweets } from "./tweets";
import { UserAuth } from "./user-auth";
import { PooledScraperStrategy } from "./pooled-strategy";

/**
 * Options for creating a scraper layer.
 */
export interface ScraperOptions {
  /**
   * Proxy URL for all HTTP requests (e.g., "http://user:pass@proxy:8080").
   */
  readonly proxyUrl?: string;

  /**
   * Override default config values.
   */
  readonly config?: Partial<{
    readonly requestTimeoutMs: number;
    readonly retryLimit: number;
    readonly paginationJitterMs: number;
    readonly sessionFailureCooldownMs: number;
  }>;
}

// ---------------------------------------------------------------------------
// Service layers (all domain services merged)
// ---------------------------------------------------------------------------

const guestServicesLayer = Layer.mergeAll(
  TwitterPublic.layer,
  TwitterTweets.layer,
);

const authenticatedServicesLayer = Layer.mergeAll(
  TwitterPublic.layer,
  TwitterSearch.layer,
  TwitterTweets.layer,
  TwitterTrends.layer,
  TwitterRelationships.layer,
  TwitterLists.layer,
  TwitterDirectMessages.layer,
);

const pooledServicesLayer = Layer.mergeAll(
  TwitterPublic.layer,
  TwitterSearch.layer,
  TwitterTweets.layer,
  TwitterTrends.layer,
  TwitterRelationships.layer,
  TwitterLists.layer,
  TwitterDirectMessages.layer,
);

const cycleTlsLayerFromConfig = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* TwitterConfig;
    return TwitterHttpClient.cycleTlsLayer(config.proxyUrl);
  }),
);

// ---------------------------------------------------------------------------
// TwitterScraper — convenience layer compositions
// ---------------------------------------------------------------------------

/**
 * Pre-composed layers for common scraper setups.
 *
 * Usage:
 * ```ts
 * // Guest-only (profiles, public timelines):
 * const layer = TwitterScraper.guestLayer();
 *
 * // Authenticated (all features):
 * const layer = TwitterScraper.authenticatedLayer();
 *
 * // Pooled (multiple sessions):
 * const layer = TwitterScraper.pooledLayer([session1Cookies, session2Cookies]);
 * ```
 */
export class TwitterScraper {
  /**
   * Guest-only layer — no authentication required.
   * Supports: getProfile, getTweets, getTweetAnonymous, getLatestTweet.
   *
   * Uses CycleTLS with Chrome TLS fingerprinting.
   */
  static guestLayer(options?: ScraperOptions) {
    const configLayer = TwitterConfig.defaultLayer({
      ...(options?.config?.requestTimeoutMs !== undefined
        ? { requestTimeout: Duration.millis(options.config.requestTimeoutMs) }
        : {}),
      ...(options?.config?.retryLimit !== undefined
        ? {
            strategy: {
              retryLimit: options.config.retryLimit,
              ...(options?.config?.sessionFailureCooldownMs !== undefined
                ? {
                    sessionFailureCooldown: Duration.millis(
                      options.config.sessionFailureCooldownMs,
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(options?.config?.retryLimit === undefined &&
      options?.config?.sessionFailureCooldownMs !== undefined
        ? {
            strategy: {
              sessionFailureCooldown: Duration.millis(
                options.config.sessionFailureCooldownMs,
              ),
            },
          }
        : {}),
      ...(options?.config?.paginationJitterMs !== undefined
        ? { pagination: { jitterMs: options.config.paginationJitterMs } }
        : {}),
    });

    return guestServicesLayer.pipe(
      Layer.provideMerge(ScraperStrategy.standardLayer),
      Layer.provideMerge(GuestAuth.liveLayer),
      Layer.provideMerge(CookieManager.liveLayer),
      Layer.provideMerge(TwitterSessionState.liveLayer),
      Layer.provideMerge(TwitterHttpClient.cycleTlsLayer(options?.proxyUrl)),
      Layer.provideMerge(configLayer),
    );
  }

  /**
   * Authenticated layer — full feature access with a single session.
   * Supports all endpoints including search, trends, DMs, lists, etc.
   *
   * Includes endpoint auto-discovery for resilience against query ID rotation.
   *
   * Usage:
   * ```ts
   * const layer = TwitterScraper.authenticatedLayer();
   *
   * const program = Effect.gen(function* () {
   *   const auth = yield* UserAuth;
   *   yield* auth.restoreCookies(myCookies);
   *
   *   const search = yield* TwitterSearch;
   *   const results = yield* Stream.runCollect(
   *     search.searchTweets("topic", { limit: 10 }),
   *   );
   * });
   *
   * Effect.runPromise(program.pipe(Effect.provide(layer)));
   * ```
   */
  static authenticatedLayer(options?: ScraperOptions) {
    const configLayer = TwitterConfig.defaultLayer({
      ...(options?.config?.requestTimeoutMs !== undefined
        ? { requestTimeout: Duration.millis(options.config.requestTimeoutMs) }
        : {}),
      ...(options?.config?.retryLimit !== undefined
        ? {
            strategy: {
              retryLimit: options.config.retryLimit,
              ...(options?.config?.sessionFailureCooldownMs !== undefined
                ? {
                    sessionFailureCooldown: Duration.millis(
                      options.config.sessionFailureCooldownMs,
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(options?.config?.retryLimit === undefined &&
      options?.config?.sessionFailureCooldownMs !== undefined
        ? {
            strategy: {
              sessionFailureCooldown: Duration.millis(
                options.config.sessionFailureCooldownMs,
              ),
            },
          }
        : {}),
      ...(options?.config?.paginationJitterMs !== undefined
        ? { pagination: { jitterMs: options.config.paginationJitterMs } }
        : {}),
    });

    return authenticatedServicesLayer.pipe(
      Layer.provideMerge(ScraperStrategy.standardLayer),
      Layer.provideMerge(GuestAuth.liveLayer),
      Layer.provideMerge(UserAuth.liveLayer),
      Layer.provideMerge(CookieManager.liveLayer),
      Layer.provideMerge(TwitterSessionState.liveLayer),
      Layer.provideMerge(TwitterEndpointDiscovery.liveLayer),
      Layer.provideMerge(TwitterHttpClient.cycleTlsLayer(options?.proxyUrl)),
      Layer.provideMerge(configLayer),
    );
  }

  /**
   * Env-configured authenticated layer — reads bearer tokens and settings
   * from environment variables instead of using test defaults.
   *
   * Required env vars:
   * - TWITTER_BEARER_TOKEN
   * - TWITTER_BEARER_TOKEN_SECONDARY
   *
   * Optional env vars:
   * - TWITTER_PROXY_URL
   * - TWITTER_REQUEST_TIMEOUT_MS (default: 30000)
   * - TWITTER_STRATEGY_RETRY_LIMIT (default: 1)
   * - TWITTER_PAGINATION_JITTER_MS (default: 500)
   */
  static authenticatedLayerFromEnv() {
    return authenticatedServicesLayer.pipe(
      Layer.provideMerge(ScraperStrategy.standardLayer),
      Layer.provideMerge(GuestAuth.liveLayer),
      Layer.provideMerge(UserAuth.liveLayer),
      Layer.provideMerge(CookieManager.liveLayer),
      Layer.provideMerge(TwitterEndpointDiscovery.liveLayer),
      Layer.provideMerge(cycleTlsLayerFromConfig),
      Layer.provideMerge(TwitterConfig.fromEnvLayer),
    );
  }

  /**
   * Pooled layer — multiple authenticated sessions with automatic
   * rate-limit-aware routing and bot detection rotation.
   *
   * Each session gets its own cookies, auth state, and rate limiter.
   * The pool selects the best session per-request based on rate limit
   * headroom, and rotates to another session on bot detection or
   * auth failures.
   *
   * Usage:
   * ```ts
   * const layer = TwitterScraper.pooledLayer([
   *   session1Cookies,
   *   session2Cookies,
   * ]);
   *
   * const program = Effect.gen(function* () {
   *   const search = yield* TwitterSearch;
   *   // Requests are automatically routed to the best session
   *   const results = yield* Stream.runCollect(
   *     search.searchTweets("topic", { limit: 50 }),
   *   );
   *
   *   // Add more sessions at runtime
   *   const pool = yield* SessionPoolManager;
   *   yield* pool.addSession(newSessionCookies);
   * });
   *
   * Effect.runPromise(program.pipe(Effect.provide(layer)));
   * ```
   */
  static pooledLayer(
    initialSessions: ReadonlyArray<ReadonlyArray<SerializedCookie>> = [],
    options?: ScraperOptions,
  ) {
    const configLayer = TwitterConfig.defaultLayer({
      ...(options?.config?.requestTimeoutMs !== undefined
        ? { requestTimeout: Duration.millis(options.config.requestTimeoutMs) }
        : {}),
      ...(options?.config?.retryLimit !== undefined
        ? {
            strategy: {
              retryLimit: options.config.retryLimit,
              ...(options?.config?.sessionFailureCooldownMs !== undefined
                ? {
                    sessionFailureCooldown: Duration.millis(
                      options.config.sessionFailureCooldownMs,
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(options?.config?.retryLimit === undefined &&
      options?.config?.sessionFailureCooldownMs !== undefined
        ? {
            strategy: {
              sessionFailureCooldown: Duration.millis(
                options.config.sessionFailureCooldownMs,
              ),
            },
          }
        : {}),
      ...(options?.config?.paginationJitterMs !== undefined
        ? { pagination: { jitterMs: options.config.paginationJitterMs } }
        : {}),
    });

    return pooledServicesLayer.pipe(
      Layer.provideMerge(PooledScraperStrategy.layer(initialSessions)),
      Layer.provideMerge(TwitterSessionState.pooledLayer),
      Layer.provideMerge(TwitterEndpointDiscovery.liveLayer),
      Layer.provideMerge(TwitterHttpClient.cycleTlsLayer(options?.proxyUrl)),
      Layer.provideMerge(configLayer),
      Layer.provide(SignedInSessionRevision.liveLayer),
    );
  }
}
