# Better Twitter Scraper — Architecture Design

An Effect-first reimplementation of [twitter-scraper](https://github.com/the-convocation/twitter-scraper), built on Effect 4 beta. This document describes the service architecture, domain model, error handling, and strategy pattern that form the foundation of the library.

## Goals

- **Effect-native**: Services, layers, schemas, typed errors, streams — no imperative escape hatches.
- **Strategy-driven**: Decouple *how* we scrape (retry, rate limiting, auth refresh) from *what* we scrape (tweets, profiles, search). Swap strategies without touching domain logic.
- **Resilient by design**: Model Twitter API instability explicitly. Rate limits, auth failures, and schema changes are first-class concerns, not afterthoughts.
- **Testable**: Every service boundary is an interface. Provide test layers to run the full domain logic against mock HTTP responses with no network, no delays.

## Reference Material

- **Original source**: `~/.local/share/effect-solutions/twitter-scraper/src/`
- **Effect source**: `~/.local/share/effect-solutions/effect/`
- **Effect guides**: `effect-solutions show <topic>` (quick-start, services-and-layers, data-modeling, error-handling, config, testing, cli)

---

## 1. ScraperStrategy — The Core Abstraction

The `ScraperStrategy` is a service (`Context.Tag`) that wraps every outgoing API call. It controls four concerns:

| Concern | Responsibility |
|---------|---------------|
| **Retry** | Exponential backoff with jitter. Conditional on error type: retry 429 and 5xx, fail immediately on 404. |
| **Rate limiting** | Per-endpoint token buckets tracking `x-rate-limit-*` response headers. |
| **Auth refresh** | Lazy guest token refresh when expired. Re-authenticate on 401/403. |
| **Request transformation** | Cipher randomization, header injection, Chrome fingerprinting. |

### Strategy Implementations

Each strategy is a `Layer` — a value you compose at the application edge.

| Strategy | Behavior |
|----------|----------|
| `Default` | Exponential backoff + token bucket + lazy auth refresh. Good for single-account usage. |
| `Aggressive` | Fast retry, higher concurrency, support for multiple accounts/token rotation. |
| `Conservative` | Longer backoff, lower rate limits, single account. For long-running background jobs. |
| `Test` | No delays, no network. For unit and integration tests. |

Domain services call `ScraperStrategy.execute(httpEffect)` and never know which strategy is active. Swapping strategies requires changing one line at the composition root.

---

## 2. Domain Model

### Branded Primitives

Compile-time safety for identifiers. A `TweetId` cannot be passed where a `UserId` is expected.

```ts
const TweetId = Schema.String.pipe(Schema.brand("TweetId"))
const UserId  = Schema.String.pipe(Schema.brand("UserId"))
const Handle  = Schema.String.pipe(Schema.brand("Handle"))
const Cursor  = Schema.String.pipe(Schema.brand("Cursor"))
```

### Core Entities

Defined as `Schema.Class`. Each entity exposes only clean, validated fields — Twitter's messy internals stay in the parsing layer.

**Tweet**
- `id: TweetId`, `authorId: UserId`, `conversationId: TweetId`
- `text: string`, `html: string`
- `hashtags: string[]`, `mentions: string[]`, `urls: string[]`
- `photos: Photo[]`, `videos: Video[]`
- `likes: number`, `replies: number`, `retweets: number`, `views: number`
- `timestamp: Date`
- `isRetweet`, `isReply`, `isQuoted`, `isSelfThread`: `boolean`
- `quotedTweet: Option<Tweet>`, `retweetedTweet: Option<Tweet>`
- `thread: Tweet[]`

**Profile**
- `id: UserId`, `handle: Handle`, `name: string`
- `avatar: string`, `banner: string`
- `biography: string`, `location: string`, `website: string`
- `joined: Date`
- `followersCount`, `followingCount`, `tweetsCount`, `likesCount`: `number`
- `isPrivate`, `isVerified`, `isBlueVerified`: `boolean`
- `pinnedTweetIds: TweetId[]`

**DirectMessage**
- `id: string`, `conversationId: string`
- `senderId: UserId`, `recipientId: UserId`
- `text: string`, `timestamp: Date`

### Raw API Schemas

Separate `Schema` definitions for Twitter's GraphQL response shapes (`RawLegacyTweet`, `RawTimelineV2`, `RawSearchTimeline`, etc.). These validate the API response and transform into clean domain types. When Twitter changes their API shape, only the raw schemas and transform functions need updating — domain types stay stable.

### Pagination

A generic page type used by all paginated operations:

```ts
class Page<T> {
  items: T[]
  nextCursor: Option<Cursor>
  previousCursor: Option<Cursor>
}
```

---

## 3. Error Model

All errors are `Schema.TaggedError` — typed, pattern-matchable, and tracked in the Effect type parameter.

| Error | Fields | Retryable? |
|-------|--------|-----------|
| `RateLimitError` | `resetAfter: number`, `remaining: number`, `endpoint: string` | Yes — wait for reset window |
| `AuthenticationError` | `reason: string` | Yes — refresh token, then retry |
| `NotFoundError` | `resource: string`, `id: string` | No |
| `SuspendedError` | `handle: Handle` | No |
| `ApiError` | `statusCode: number`, `message: string`, `endpoint: string` | Depends on status code |
| `ParseError` | `endpoint: string`, `message: string` | No — indicates API schema change |

Domain services declare exactly which errors they can produce. The type system enforces exhaustive handling:

```ts
getTweet(id: TweetId): Effect<Tweet, NotFoundError | ApiError | ParseError, ScraperStrategy>
searchTweets(query): Effect<Stream<Tweet>, AuthenticationError | ApiError | ParseError, ScraperStrategy>
```

The `ScraperStrategy` handles retryable errors internally (retry on `RateLimitError`, refresh on `AuthenticationError`). Non-retryable errors propagate to the caller.

---

## 4. Infrastructure Services

### TwitterAuth

Manages authentication state. Two implementations as separate layers:

- **`TwitterAuth.Guest`** — fetches guest tokens from `/activate`. Lazy refresh when token age exceeds 3 hours. Token stored in `Ref<Option<GuestToken>>`.
- **`TwitterAuth.User`** — multi-step login flow with subtask handlers for password, 2FA, and CAPTCHA. Session maintained via cookies. Supports custom subtask handlers via a registry (`Ref<Map<string, SubtaskHandler>>`).

Exposes: `installHeaders(request)`, `refreshToken`, `isLoggedIn`, `login(credentials)`, `logout`.

### TwitterHttpClient

Wraps Effect's `HttpClient` with Twitter-specific middleware, composed via `HttpClient.mapRequest` / `HttpClient.mapResponseEffect`:

1. Base URL prefixing (`https://api.x.com/graphql/...`)
2. Auth header injection (delegates to `TwitterAuth.installHeaders`)
3. Chrome fingerprint headers (User-Agent, Sec-CH-UA, Sec-Fetch-*)
4. TLS cipher randomization (platform-specific)
5. GraphQL request builder — typed helper for constructing `variables` + `features` + `fieldToggles`
6. Response header extraction — reads `x-rate-limit-*` headers and feeds them to the `RateLimiter`

### CookieManager

Owns cookie state via `Ref<CookieJar>`:

- CSRF token (`ct0`) management with "never delete" protection (matches original behavior)
- Session token (`auth_token`) persistence
- `getCookies` / `setCookies` for external persistence (save/restore between runs)

### RateLimiter

Per-endpoint token buckets using Effect's `RateLimiter.make`:

- Tracks limits from `x-rate-limit-*` response headers
- Default budgets per endpoint (timeline: 150/15min, search: 50/15min, profile: 95/15min)
- Composable — global limit + per-endpoint limit applied together
- When budget exhausted: delay (default) or fail with `RateLimitError` (configurable)

### Config

Loaded via `Effect.Config` from environment variables, with defaults:

| Variable | Type | Default |
|----------|------|---------|
| `TWITTER_BEARER_TOKEN` | `Redacted` | Built-in public token |
| `TWITTER_BEARER_TOKEN_2` | `Redacted` | Built-in search token |
| `TWITTER_PROXY_URL` | `Option<string>` | None |
| `TWITTER_USER_AGENT` | `string` | Chrome 144 fingerprint |
| `TWITTER_TIMEOUT` | `Duration` | 30 seconds |
| `TWITTER_MAX_RETRIES` | `number` | 3 |

Sensitive values use `Config.redacted` — hidden in logs and traces.

---

## 5. Domain Services

Each service is a `Context.Tag` with methods that return `Effect` or `Stream`. Dependencies flow through the type system — services never instantiate their own dependencies.

### TweetService

| Method | Return Type |
|--------|-------------|
| `getTweet(id)` | `Effect<Tweet, NotFoundError \| ApiError \| ParseError>` |
| `getTweets(userId, count)` | `Stream<Tweet, ApiError \| ParseError>` |
| `getTweetsAndReplies(userId)` | `Stream<Tweet, ApiError \| ParseError>` |
| `getLatestTweet(userId)` | `Effect<Option<Tweet>, ApiError \| ParseError>` |
| `getTweetWhere(userId, predicate)` | `Effect<Option<Tweet>, ApiError \| ParseError>` |

### ProfileService

| Method | Return Type |
|--------|-------------|
| `getProfile(handle)` | `Effect<Profile, NotFoundError \| SuspendedError \| ApiError \| ParseError>` |
| `getFollowers(userId)` | `Stream<Profile, AuthenticationError \| ApiError \| ParseError>` |
| `getFollowing(userId)` | `Stream<Profile, AuthenticationError \| ApiError \| ParseError>` |

### SearchService

| Method | Return Type |
|--------|-------------|
| `searchTweets(query, mode)` | `Stream<Tweet, AuthenticationError \| ApiError \| ParseError>` |
| `searchProfiles(query)` | `Stream<Profile, AuthenticationError \| ApiError \| ParseError>` |

`SearchMode` is a union: `Top | Latest | Photos | Videos | People`.

### TimelineService

The internal pagination engine. Exposes one generic function that all other services delegate to:

```ts
paginate<T>(
  fetch: (cursor: Option<Cursor>) => Effect<Page<T>, E, R>
): Stream<T, E, R>
```

Unfolds a `Stream` from cursor-based pagination. Inter-page delay is controlled by the `ScraperStrategy` (jitter included). Stops when the API returns no next cursor or an empty page.

### DirectMessageService

| Method | Return Type |
|--------|-------------|
| `getInbox()` | `Effect<DmInbox, AuthenticationError \| ApiError \| ParseError>` |
| `getConversation(id)` | `Stream<DmMessage, AuthenticationError \| ApiError \| ParseError>` |
| `getMessages(conversationId)` | `Stream<DmMessage, AuthenticationError \| ApiError \| ParseError>` |

---

## 6. Layer Composition

The full application wires together as a single layer tree:

```
ScraperLive
  ├── ScraperStrategy.Default
  ├── TwitterAuth.Guest (or .User)
  ├── TwitterHttpClient.Live
  │     └── HttpClient.layer (Effect platform)
  ├── CookieManager.Live
  ├── RateLimiter.Live
  └── TwitterConfig.FromEnv
```

### Usage

```ts
const program = Effect.gen(function* () {
  const tweets = yield* TweetService
  const stream = yield* tweets.getTweets(UserId.make("12345"), 100)
  return yield* Stream.runCollect(stream)
}).pipe(Effect.provide(ScraperLive))

Effect.runPromise(program)
```

### Swapping Strategy

```ts
const aggressive = ScraperLive.pipe(
  Layer.provide(ScraperStrategy.Aggressive)
)

const forTesting = Layer.mergeAll(
  ScraperStrategy.Test,
  TwitterHttpClient.Test,
  TwitterAuth.Test,
  CookieManager.Test,
  RateLimiter.Test,
  TwitterConfig.Test,
)
```

### Isolation

Two scrapers with different strategies can run in the same process. Each `Effect.provide` creates an isolated service graph — no shared mutable state leaks between them.

---

## 7. Project Structure

```
src/
  index.ts                    — Public API re-exports
  strategy/
    ScraperStrategy.ts        — Tag, interface, Default/Aggressive/Conservative/Test layers
  domain/
    Tweet.ts                  — Tweet schema, branded TweetId
    Profile.ts                — Profile schema, branded Handle, UserId
    DirectMessage.ts          — DM schemas
    Page.ts                   — Generic Page<T> with cursors
    SearchMode.ts             — Top | Latest | Photos | Videos | People
  errors/
    index.ts                  — All TaggedError definitions
  services/
    TweetService.ts           — Tag + Live layer
    ProfileService.ts
    SearchService.ts
    TimelineService.ts        — Generic paginate function
    DirectMessageService.ts
  infra/
    TwitterAuth.ts            — Guest + User layers
    TwitterHttpClient.ts      — Middleware-composed HTTP client
    CookieManager.ts
    RateLimiter.ts
    Config.ts
  raw/
    types.ts                  — Raw GraphQL response schemas
    endpoints.ts              — Endpoint URLs, operation IDs, feature flags
    parsers.ts                — Raw → domain transformation functions
```

---

## 8. Open Questions

1. **Streaming backpressure**: Should `Stream`-returning methods support backpressure signaling to slow down pagination, or is inter-page jitter sufficient?
2. **Multi-account**: Should the strategy layer support token rotation across multiple accounts, or is that a separate concern layered on top?
3. **Persistence**: Should `CookieManager` support pluggable persistence backends (file, database), or just expose get/set for the caller to handle?
4. **Observability**: Should we add `Effect.withSpan` tracing to every service method from the start, or add it later?
