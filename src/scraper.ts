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

    // Dependency tiers:
    //   T0 (leaves):  Config, HttpClient, CookieManager
    //   T1 (state):   SessionState(Cookie) — not needed by guestServices but
    //                 included for ScraperStrategy's cache-key derivation
    //   T2 (auth):    GuestAuth(Config+Cookie+Http)
    //   T3 (strategy): ScraperStrategy(all above)
    //   T4 (domain):  guestServicesLayer(Strategy)
    const tier0 = Layer.mergeAll(
      configLayer,
      TwitterHttpClient.cycleTlsLayer(options?.proxyUrl),
      CookieManager.liveLayer,
    );
    const tier1 = TwitterSessionState.liveLayer.pipe(
      Layer.provideMerge(tier0),
    );
    const tier2 = GuestAuth.liveLayer.pipe(
      Layer.provideMerge(tier1),
    );
    const tier3 = ScraperStrategy.standardLayer.pipe(
      Layer.provideMerge(tier2),
    );

    return guestServicesLayer.pipe(
      Layer.provideMerge(tier3),
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

    // Dependency tiers (bottom-up):
    //   T0 (leaves):  Config, HttpClient, CookieManager
    //   T1 (infra):   EndpointDiscovery(Http+Config), SessionState(Cookie)
    //   T2 (auth):    GuestAuth(Config+Cookie+Http), UserAuth(Cookie+Config)
    //   T3 (strategy): ScraperStrategy(all above)
    //   T4 (domain):  authenticatedServicesLayer(Strategy+SessionState)
    const tier0 = Layer.mergeAll(
      configLayer,
      TwitterHttpClient.cycleTlsLayer(options?.proxyUrl),
      CookieManager.liveLayer,
    );
    const tier1 = Layer.mergeAll(
      TwitterEndpointDiscovery.liveLayer,
      TwitterSessionState.liveLayer,
    ).pipe(Layer.provideMerge(tier0));
    const tier2 = Layer.mergeAll(
      GuestAuth.liveLayer,
      UserAuth.liveLayer,
    ).pipe(Layer.provideMerge(tier1));
    const tier3 = ScraperStrategy.standardLayer.pipe(
      Layer.provideMerge(tier2),
    );

    return authenticatedServicesLayer.pipe(
      Layer.provideMerge(tier3),
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
    // Dependency tiers — same structure as authenticatedLayer but
    // using env-based config and CycleTLS that reads proxy from config.
    const tier0 = Layer.mergeAll(
      TwitterConfig.fromEnvLayer,
      CookieManager.liveLayer,
    );
    // cycleTlsLayerFromConfig needs TwitterConfig via Layer.unwrap,
    // so it sits in tier0.5 — it's a leaf from the perspective of
    // everything above, but needs Config.
    const tier0Http = cycleTlsLayerFromConfig.pipe(
      Layer.provideMerge(tier0),
    );
    const tier1 = Layer.mergeAll(
      TwitterEndpointDiscovery.liveLayer,
      TwitterSessionState.liveLayer,
    ).pipe(Layer.provideMerge(tier0Http));
    const tier2 = Layer.mergeAll(
      GuestAuth.liveLayer,
      UserAuth.liveLayer,
    ).pipe(Layer.provideMerge(tier1));
    const tier3 = ScraperStrategy.standardLayer.pipe(
      Layer.provideMerge(tier2),
    );

    return authenticatedServicesLayer.pipe(
      Layer.provideMerge(tier3),
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

    // Dependency tiers:
    //   T0 (leaves):  Config, HttpClient, SignedInSessionRevision
    //   T1 (infra):   EndpointDiscovery(Http+Config)
    //   T2 (pool):    PooledScraperStrategy(Config+Http+Discovery) -> outputs ScraperStrategy + SessionPoolManager
    //   T3 (state):   TwitterSessionState.pooledLayer(SessionPoolManager)
    //   T4 (domain):  pooledServicesLayer(Strategy+SessionState)
    const tier0 = Layer.mergeAll(
      configLayer,
      TwitterHttpClient.cycleTlsLayer(options?.proxyUrl),
    );
    const tier1 = TwitterEndpointDiscovery.liveLayer.pipe(
      Layer.provideMerge(tier0),
    );
    // PooledScraperStrategy outputs both ScraperStrategy and SessionPoolManager.
    // SessionPoolManager must be visible to TwitterSessionState.pooledLayer.
    const tier2 = PooledScraperStrategy.layer(initialSessions).pipe(
      Layer.provideMerge(tier1),
    );
    // TwitterSessionState.pooledLayer needs SessionPoolManager from tier2.
    const tier3 = TwitterSessionState.pooledLayer.pipe(
      Layer.provideMerge(tier2),
    );

    return pooledServicesLayer.pipe(
      Layer.provideMerge(tier3),
      Layer.provide(SignedInSessionRevision.liveLayer),
    );
  }
}
