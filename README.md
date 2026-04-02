# @pooks/twitter-scraper

Effect-native Twitter/X scraper with session pooling, TLS fingerprinting, and endpoint auto-discovery.

Built on [Effect](https://effect.website) for typed errors, structured concurrency, and composable service layers.

## Install

```bash
bun add @pooks/twitter-scraper effect
# or
npm install @pooks/twitter-scraper effect
```

## Quick Start

### Guest Mode (no auth required)

Fetch public profiles and timelines without any credentials:

```typescript
import { Effect, Stream } from "effect";
import { TwitterScraper, TwitterPublic } from "@pooks/twitter-scraper";

const layer = TwitterScraper.guestLayer();

const program = Effect.gen(function* () {
  const twitter = yield* TwitterPublic;

  const profile = yield* twitter.getProfile("NASA");
  console.log(profile.username, profile.followersCount);

  const tweets = yield* Stream.runCollect(
    twitter.getTweets("NASA", { limit: 5 }),
  );

  for (const tweet of tweets) {
    console.log(tweet.text);
    console.log("  photos:", tweet.photos.length, "videos:", tweet.videos.length);
  }
});

Effect.runPromise(program.pipe(Effect.provide(layer)));
```

### Authenticated Mode

Search, trends, followers, lists, DMs, and more — requires browser cookies:

```typescript
import { Effect, Stream } from "effect";
import {
  TwitterScraper,
  TwitterPublic,
  TwitterSearch,
  TwitterTrends,
  UserAuth,
} from "@pooks/twitter-scraper";

const layer = TwitterScraper.authenticatedLayer();

const program = Effect.gen(function* () {
  const auth = yield* UserAuth;
  yield* auth.restoreCookies(myCookies); // from browser export

  const search = yield* TwitterSearch;
  const tweets = yield* Stream.runCollect(
    search.searchTweets("typescript effect", { limit: 10, mode: "top" }),
  );

  const trends = yield* TwitterTrends;
  const trending = yield* trends.getTrends();

  const twitter = yield* TwitterPublic;
  const latest = yield* twitter.getLatestTweet("taborfalws");
});

Effect.runPromise(program.pipe(Effect.provide(layer)));
```

### Pooled Mode (multiple sessions)

Rotate between sessions automatically based on rate limits and bot detection:

```typescript
import { Effect, Stream } from "effect";
import {
  TwitterScraper,
  TwitterSearch,
  SessionPoolManager,
} from "@pooks/twitter-scraper";

const layer = TwitterScraper.pooledLayer([
  session1Cookies,
  session2Cookies,
]);

const program = Effect.gen(function* () {
  const search = yield* TwitterSearch;

  // Requests automatically route to the least-loaded session.
  // If one session gets bot-detected, it rotates to the next.
  const tweets = yield* Stream.runCollect(
    search.searchTweets("breaking news", { limit: 50 }),
  );

  // Add more sessions at runtime
  const pool = yield* SessionPoolManager;
  yield* pool.addSession(newSessionCookies);
});

Effect.runPromise(program.pipe(Effect.provide(layer)));
```

## Features

### Endpoints

| Endpoint | Auth | Method |
|----------|------|--------|
| Profile lookup | Guest | `TwitterPublic.getProfile(username)` |
| User tweets | Guest | `TwitterPublic.getTweets(username)` |
| Latest tweet | Guest | `TwitterPublic.getLatestTweet(username)` |
| Anonymous tweet | Guest | `TwitterTweets.getTweetAnonymous(id)` |
| Tweet detail | User | `TwitterTweets.getTweet(id)` |
| Thread projection | User | `TwitterTweets.getThread(id)` |
| Home timeline | User | `TwitterTweets.getHomeTimeline()` |
| Tweets & replies | User | `TwitterPublic.getTweetsAndReplies(username)` |
| Liked tweets | User | `TwitterPublic.getLikedTweets(username)` |
| Search tweets | User | `TwitterSearch.searchTweets(query)` |
| Search profiles | User | `TwitterSearch.searchProfiles(query)` |
| Followers | User | `TwitterRelationships.getFollowers(userId)` |
| Following | User | `TwitterRelationships.getFollowing(userId)` |
| List timeline | User | `TwitterLists.getTweets(listId)` |
| Community tweets | User | `TwitterPublic.getCommunityTweets(communityId)` |
| Trends | User | `TwitterTrends.getTrends()` |
| DM inbox | User | `TwitterDirectMessages.getInbox()` |
| DM conversation | User | `TwitterDirectMessages.getConversation(id)` |

### Data Model

Tweets include full media, engagement metrics, and metadata:

```typescript
tweet.id            // "1234567890"
tweet.text          // "Hello world"
tweet.html          // "<a href=...>Hello</a> world"
tweet.photos        // [{ id, url, altText }]
tweet.videos        // [{ id, url, preview }]
tweet.likes         // 42
tweet.retweets      // 7
tweet.views         // 1500
tweet.place         // { name: "Austin", country: "US", ... }
tweet.isRetweet     // false
tweet.isEdited      // true
tweet.isPinned      // false
tweet.isPromoted    // false
tweet.isSelfThread  // true
```

Thread projections give you structured conversation views:

```typescript
import { getConversationProjection } from "@pooks/twitter-scraper";

const doc = yield* tweets.getTweet(id);
const projection = getConversationProjection(doc);

projection.tweet          // the focal tweet
projection.selfThread     // author's thread continuation
projection.replyChain     // chain from root to focal tweet
projection.directReplies  // immediate replies
projection.replyTree      // full recursive reply tree
projection.quotedTweet    // quoted tweet if any
```

### Resilience

- **Request timeouts** -- configurable, defaults to 30s
- **Transient retry** -- exponential backoff with jitter on network errors
- **Per-bucket rate limiting** -- tracks `x-rate-limit-*` headers per endpoint
- **Configurable retry** -- adjustable retry limit for rate limits and auth failures
- **Pagination jitter** -- random delay between pages to avoid bot detection (default 500ms)
- **Bot detection classification** -- distinguishes 399 and empty-404 patterns
- **Session rotation** -- pooled mode rotates on bot detection or auth failures

### Anti-Detection

- **CycleTLS** -- Chrome 144 TLS fingerprint (JA3/JA4R/HTTP2)
- **Transaction ID** -- `x-client-transaction-id` header generated from x.com document
- **XPFF** -- `x-xp-forwarded-for` encrypted header
- **Endpoint auto-discovery** -- GraphQL query IDs scraped from x.com JS bundles, with hardcoded fallbacks
- **Proxy support** -- pass `proxyUrl` to any layer

## Configuration

### Options

```typescript
TwitterScraper.authenticatedLayer({
  proxyUrl: "http://user:pass@proxy:8080",
  config: {
    requestTimeoutMs: 15000,
    retryLimit: 2,
    paginationJitterMs: 1000,
  },
});
```

### Environment Variables

Use `TwitterScraper.authenticatedLayerFromEnv()` to read from env:

| Variable | Default | Description |
|----------|---------|-------------|
| `TWITTER_BEARER_TOKEN` | (required) | Primary bearer token |
| `TWITTER_BEARER_TOKEN_SECONDARY` | (required) | Secondary bearer token |
| `TWITTER_PROXY_URL` | -- | HTTP proxy URL |
| `TWITTER_REQUEST_TIMEOUT_MS` | 30000 | Request timeout |
| `TWITTER_STRATEGY_RETRY_LIMIT` | 1 | Max retries per request |
| `TWITTER_PAGINATION_JITTER_MS` | 500 | Random delay between pages |

### Cookie Export

Export cookies from your browser using the included script:

```bash
bun run cookies:extract
```

Or set the `TWITTER_COOKIES` environment variable with a JSON array of serialized cookies.

## Error Handling

All errors are typed and tagged for pattern matching:

```typescript
import {
  AuthenticationError,
  BotDetectionError,
  RateLimitError,
  ProfileNotFoundError,
} from "@pooks/twitter-scraper";

const result = yield* twitter.getProfile("someone").pipe(
  Effect.catchTags({
    ProfileNotFoundError: (e) => ...,
    BotDetectionError: (e) => ...,
    RateLimitError: (e) => ...,
    AuthenticationError: (e) => ...,
  }),
);
```

## Advanced: Custom Layer Composition

For full control, compose layers manually:

```typescript
import { Layer } from "effect";
import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
  TwitterSearch,
  TwitterEndpointDiscovery,
  UserAuth,
} from "@pooks/twitter-scraper";

const layer = Layer.mergeAll(
  TwitterPublic.layer,
  TwitterSearch.layer,
).pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
  Layer.provideMerge(UserAuth.liveLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterEndpointDiscovery.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer()),
  Layer.provideMerge(TwitterConfig.testLayer()),
);
```

## License

MIT
