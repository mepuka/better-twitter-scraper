# Better Twitter Scraper — Architecture Design (v2)

An Effect-first reimplementation of [twitter-scraper](https://github.com/the-convocation/twitter-scraper), built on Effect 4 beta.

## Goals

- **Effect-native**: Services, layers, schemas, typed errors, streams.
- **Strategy-driven**: Decouple *how* we scrape (retry, rate limiting, auth refresh) from *what* we scrape. Strategies are a required dependency the caller provides — no defaults baked in.
- **Resilient by design**: Model Twitter API instability explicitly — including the many endpoint families, auth modes, bearer token choices, and non-obvious failure modes.
- **Testable from the start**: Every service boundary is an interface. `Effect.withSpan` tracing on all service methods. Test layers with mock HTTP responses.

## Reference Material

- **Original source**: `~/.local/share/effect-solutions/twitter-scraper/src/`
- **Effect source**: `~/.local/share/effect-solutions/effect/`
- **Effect guides**: `effect-solutions show <topic>`

---

## 1. Endpoint Families

Twitter/X is not one API. The original scraper talks to five distinct endpoint families, each with different base URLs, auth modes, and response formats. Within the GraphQL family, some endpoints use the secondary bearer token — this is modeled via `BearerTokenChoice` on the request, not as a separate family.

| Family | Base URL | Auth | Response Format |
|--------|----------|------|-----------------|
| **GraphQL** | `api.x.com/graphql/{opId}/{opName}` | Guest or User | Nested JSON with `data.user.result.timeline...` |
| **REST** | `x.com/i/api/1.1/dm/...` | User required | Flat JSON |
| **LoginFlow** | `api.x.com/1.1/onboarding/task.json` | Guest (no CSRF) | Flow subtask responses |
| **Activation** | `api.x.com/1.1/guest/activate.json` | None (bootstrap) | `{guest_token: string}` |
| **PageVisit** | `x.com` (HTML) | None | HTML (cookie establishment, guest token extraction) |

Bearer token selection is orthogonal to endpoint family. GraphQL endpoints like `SearchTimeline`, `UserTweets`, and `Followers` use `bearerToken2`; others use `bearerToken`. This is encoded per-request via `BearerTokenChoice`, not per-family.

### ApiRequest — Typed Request Descriptor

Rather than `execute(httpEffect)`, the strategy receives a typed request that carries all the metadata it needs:

```ts
class ApiRequest<T> extends Schema.Class<ApiRequest<T>>("ApiRequest")({
  endpoint: EndpointId,          // e.g. "UserTweets", "SearchTimeline", "DmInbox"
  family: EndpointFamily,        // GraphQL | REST | LoginFlow | Activation | PageVisit
  authRequirement: AuthRequirement, // Guest | User | None
  bearerTokenChoice: BearerTokenChoice, // Primary | Secondary
  rateLimitBucket: RateLimitBucket,  // per-endpoint bucket ID
  method: HttpMethod,            // GET | POST
  url: string,                   // fully constructed URL
  headers: Headers,              // additional endpoint-specific headers
  body: Option<unknown>,         // POST body if applicable
}) {}
```

The strategy can inspect any field to make routing, retry, and rate-limiting decisions. Domain services construct `ApiRequest` values; the strategy decides how to execute them.

### EndpointFamily type

```ts
type EndpointFamily = "GraphQL" | "REST" | "LoginFlow" | "Activation" | "PageVisit"
```

### BearerTokenChoice

```ts
type BearerTokenChoice = "Primary" | "Secondary"
```

The original scraper uses two hardcoded bearer tokens (`bearerToken` and `bearerToken2` in `api.ts:33-37`). `bearerToken2` is used for search, UserTweets, and login endpoints. This choice must be explicit per-request, not a global setting.

---

## 2. Auth Capabilities

Guest mode and logged-in mode are not interchangeable. Search (`search.ts:89`) and DMs (`direct-messages.ts:131`) require `isLoggedIn()`. The type system must enforce this at compile time.

### Two distinct capability types

```ts
// Base: available to all auth modes
interface GuestAuth {
  readonly installHeaders: (request: ApiRequest<any>) => Effect<ApiRequest<any>, AuthenticationError>
  readonly refreshToken: Effect<void, AuthenticationError>
  readonly ensureToken: Effect<void, AuthenticationError>
}

// Extended: requires login
interface UserAuth extends GuestAuth {
  readonly login: (credentials: LoginCredentials) => Effect<void, AuthenticationError>
  readonly logout: Effect<void, AuthenticationError>
  readonly isLoggedIn: Effect<boolean>
}
```

### Services declare their auth requirement in R

```ts
// Works with guest token — R includes GuestAuth
getTweet(id: TweetId): Effect<Tweet, TweetError, GuestAuth | TwitterHttpClient | ...>

// Requires login — R includes UserAuth (NOT GuestAuth)
searchTweets(query, mode): Stream<Tweet, SearchError, UserAuth | TwitterHttpClient | ...>
getInbox(): Effect<DmInbox, DmError, UserAuth | TwitterHttpClient | ...>
```

If you provide `GuestAuth.Live` but try to use `SearchService`, the compiler rejects it — `UserAuth` is unsatisfied. No runtime `isLoggedIn()` check needed in domain code.

### Login flow complexity

The original's login is a multi-step process:

1. **Preflight**: visit `x.com` to establish Cloudflare cookies and extract guest token from inline `<script>`
2. **Fallback activation**: call `/guest/activate.json` only if preflight didn't set the token
3. **CSRF avoidance**: do NOT send `x-csrf-token` during login (triggers bot detection error 399)
4. **Subtask loop**: iterate through subtasks (enter username, enter password, 2FA, CAPTCHA)
5. **Custom handlers**: users can register handlers for specific subtask IDs

The `UserAuth.Live` layer must model all of this. The subtask handler registry is a `Ref<HashMap<string, SubtaskHandler>>` where:

```ts
type SubtaskHandler = (
  subtaskId: string,
  previousResponse: FlowResponse,
  credentials: LoginCredentials,
  api: FlowApi,
) => Effect<FlowTokenResult, AuthenticationError>
```

---

## 3. ScraperStrategy — Revised

The strategy is a required, unsatisfied dependency. There is no default baked into the layer tree.

### Interface

```ts
interface ScraperStrategy {
  readonly execute: <T>(request: ApiRequest<T>) => Effect<T, ApiError | RateLimitError | AuthenticationError>
}
```

The strategy receives the full `ApiRequest` — it knows the endpoint, family, auth requirement, bearer token choice, and rate limit bucket. It decides:

- Which retry schedule to use (may vary by endpoint family)
- Whether to consult the rate limiter (and which bucket)
- Whether to refresh auth before or after failure
- How to handle non-standard failures (e.g., `x-rate-limit-incoming == '0'` → delete token)

### Implementations as Layers

```ts
// Caller MUST provide one — no default
ScraperStrategy.Standard   // exponential backoff + token bucket + lazy refresh
ScraperStrategy.Aggressive // fast retry, higher concurrency
ScraperStrategy.Conservative // longer backoff, lower limits
ScraperStrategy.Test       // no delays, no network
```

### Layer composition — strategy is NOT included

Services depend on each other (e.g., `TwitterHttpClient` depends on auth and cookies). Use `Layer.provideMerge` to wire dependencies between layers, and `Layer.mergeAll` only for independent siblings.

```ts
// Infrastructure: HttpClient depends on CookieManager, Config
const InfraLive = TwitterHttpClient.Live.pipe(
  Layer.provideMerge(CookieManager.Live),
  Layer.provideMerge(RateLimiter.Live),
  Layer.provideMerge(TwitterConfig.FromEnv),
  Layer.provideMerge(HttpClient.layer),
)

// Guest scraper: strategy + guest auth + infra
const GuestScraper = ScraperStrategy.Standard.pipe(
  Layer.provideMerge(GuestAuth.Live),
  Layer.provideMerge(InfraLive),
)

// User scraper: strategy + user auth + infra
const UserScraper = ScraperStrategy.Standard.pipe(
  Layer.provideMerge(UserAuth.Live),
  Layer.provideMerge(InfraLive),
)

// Swap strategy — replace one layer, everything else unchanged
const AggressiveUserScraper = ScraperStrategy.Aggressive.pipe(
  Layer.provideMerge(UserAuth.Live),
  Layer.provideMerge(InfraLive),
)
```

---

## 4. Domain Model

### Branded Primitives

```ts
const TweetId = Schema.String.pipe(Schema.brand("TweetId"))
const UserId  = Schema.String.pipe(Schema.brand("UserId"))
const Handle  = Schema.String.pipe(Schema.brand("Handle"))
```

### Core Entities

`Schema.Class` definitions. Only clean, validated fields exposed.

**Tweet** — `id`, `authorId`, `conversationId`, `text`, `html`, `hashtags`, `mentions`, `urls`, `photos`, `videos`, `likes`, `replies`, `retweets`, `views`, `timestamp`, boolean flags (`isRetweet`, `isReply`, `isQuoted`, `isSelfThread`), optional nested `quotedTweet` / `retweetedTweet`, `thread`.

**Profile** — `id`, `handle`, `name`, `avatar`, `banner`, `biography`, `location`, `website`, `joined`, counts (`followers`, `following`, `tweets`, `likes`), flags (`isPrivate`, `isVerified`, `isBlueVerified`), `pinnedTweetIds`.

**DirectMessage** — `id`, `conversationId`, `senderId`, `recipientId`, `text`, `timestamp`, `reactions`.

### Raw API Schemas

Separate schemas for each endpoint family's response shape. The transform boundary is explicit: `RawLegacyTweet → Tweet`, `RawTimelineV2 → Array<Tweet>`, etc. When Twitter changes their response shape, only the raw schemas and transform functions update.

---

## 5. Pagination — Multiple Page State Types

A single generic cursor does not fit all endpoints. DMs use `maxId`/`minId` with an `AT_END` status flag. Tweet timelines use a single opaque cursor string. These are different types.

### TimelinePage — for tweet/profile timelines and search

```ts
class TimelinePage<T> extends Schema.Class<TimelinePage<T>>("TimelinePage")({
  items: Schema.Array(Schema.Unknown), // parameterized at use site
  nextCursor: Schema.OptionFromUndefinedOr(Schema.String),
  previousCursor: Schema.OptionFromUndefinedOr(Schema.String),
}) {}
```

Stop condition: `nextCursor` is `None` or items are empty.

### DmPage — for direct message conversations

```ts
class DmPage extends Schema.Class<DmPage>("DmPage")({
  entries: Schema.Array(DmMessageEntry),
  status: DmStatus,           // "HAS_MORE" | "AT_END"
  minEntryId: Schema.String,
  maxEntryId: Schema.OptionFromUndefinedOr(Schema.String),
}) {}

class DmCursor extends Schema.Class<DmCursor>("DmCursor")({
  maxId: Schema.OptionFromUndefinedOr(Schema.String),
  minId: Schema.OptionFromUndefinedOr(Schema.String),
}) {}
```

Stop condition: `status === "AT_END"` or no next cursor.

### Pagination functions — one per shape

```ts
// Timeline/search pagination
paginateTimeline<T>(
  fetch: (cursor: Option<string>) => Effect<TimelinePage<T>, E, R>
): Stream<T, E, R>

// DM pagination
paginateDm(
  fetch: (cursor: Option<DmCursor>) => Effect<DmPage, E, R>
): Stream<DmMessageEntry, E, R>
```

Both unfold a `Stream` with inter-page jitter. The stop conditions are type-specific and correct for each shape.

---

## 6. Error Model

All errors are `Schema.TaggedError`.

| Error | Fields | Retryable? |
|-------|--------|-----------|
| `RateLimitError` | `resetAfter`, `remaining`, `endpoint`, `bucket` | Yes — wait for reset |
| `AuthenticationError` | `reason`, `endpoint` | Yes — refresh token, retry once |
| `NotFoundError` | `resource`, `id` | No |
| `SuspendedError` | `handle` | No |
| `ApiError` | `statusCode`, `message`, `endpoint`, `family` | 5xx yes, 4xx no |
| `ParseError` | `endpoint`, `message`, `rawBody` | No — API schema change |
| `BotDetectionError` | `endpoint`, `statusCode` | Maybe — may need new cookies/fingerprint |

Note `BotDetectionError` (HTTP 399, unexpected 404s from TLS fingerprinting). The original handles this with cipher randomization; we should model it explicitly since the recovery path is different from a normal retry.

Non-standard failure: `x-rate-limit-incoming == '0'` means the token is about to be rate-limited. The original deletes the guest token proactively (`api.ts:133-134`). The strategy must handle this — it's not a 429, it's a 200 with a warning header.

---

## 7. Public API — Consistent Signatures

All paginated operations return `Stream<T, E, R>` directly. All single-value operations return `Effect<T, E, R>`. No `Effect<Stream<...>>` wrapping.

### TweetService

```ts
interface TweetService {
  getTweet(id: TweetId): Effect<Tweet, NotFoundError | ApiError | ParseError, GuestAuth | ScraperStrategy>
  getTweets(userId: UserId): Stream<Tweet, ApiError | ParseError, GuestAuth | ScraperStrategy>
  getTweetsAndReplies(userId: UserId): Stream<Tweet, ApiError | ParseError, GuestAuth | ScraperStrategy>
  getLatestTweet(userId: UserId): Effect<Option<Tweet>, ApiError | ParseError, GuestAuth | ScraperStrategy>
  getTweetWhere(userId: UserId, predicate: (t: Tweet) => boolean): Effect<Option<Tweet>, ApiError | ParseError, GuestAuth | ScraperStrategy>
}
```

### ProfileService

```ts
interface ProfileService {
  getProfile(handle: Handle): Effect<Profile, NotFoundError | SuspendedError | ApiError | ParseError, GuestAuth | ScraperStrategy>
  getFollowers(userId: UserId): Stream<Profile, AuthenticationError | ApiError | ParseError, UserAuth | ScraperStrategy>
  getFollowing(userId: UserId): Stream<Profile, AuthenticationError | ApiError | ParseError, UserAuth | ScraperStrategy>
}
```

Note: `getFollowers`/`getFollowing` require `UserAuth`, not `GuestAuth`.

### SearchService

```ts
interface SearchService {
  searchTweets(query: string, mode: SearchMode): Stream<Tweet, AuthenticationError | ApiError | ParseError, UserAuth | ScraperStrategy>
  searchProfiles(query: string): Stream<Profile, AuthenticationError | ApiError | ParseError, UserAuth | ScraperStrategy>
}
```

All search operations require `UserAuth`.

### DirectMessageService

```ts
interface DirectMessageService {
  getInbox(): Effect<DmInbox, AuthenticationError | ApiError | ParseError, UserAuth | ScraperStrategy>
  getConversation(id: string): Stream<DmMessageEntry, AuthenticationError | ApiError | ParseError, UserAuth | ScraperStrategy>
}
```

All DM operations require `UserAuth`.

### TrendsService

```ts
interface TrendsService {
  getTrends(): Effect<Array<string>, ApiError | ParseError, GuestAuth | ScraperStrategy>
}
```

---

## 8. Infrastructure Services

### TwitterHttpClient

Executes `ApiRequest` values. Does NOT include retry or rate limiting — that's the strategy's job.

Responsibilities:
1. Select bearer token based on `request.bearerTokenChoice`
2. Delegate to `GuestAuth` or `UserAuth` for header installation based on `request.authRequirement`
3. Apply Chrome fingerprint headers
4. Randomize TLS ciphers (platform-specific)
5. Execute HTTP request via Effect's `HttpClient`
6. Extract rate-limit headers from response and feed to `RateLimiter`
7. Parse response based on `request.family` (GraphQL nested extraction vs REST flat JSON vs HTML)

### CookieManager

Owns cookie state via `Ref<CookieJar>`:
- CSRF token (`ct0`): never delete, even when Twitter sends `Max-Age=0`
- Session token (`auth_token`): persistence for authenticated sessions
- `getCookies` / `setCookies`: for external persistence between runs

### RateLimiter

Per-endpoint token buckets:
- Keyed by `RateLimitBucket` (derived from endpoint ID)
- Updated from `x-rate-limit-*` response headers after each request
- Strategy queries the limiter before executing, decides whether to delay or fail
- Handles the `x-rate-limit-incoming == '0'` proactive warning

### Config

```ts
interface TwitterConfig {
  readonly bearerToken: Redacted       // Primary bearer token
  readonly bearerToken2: Redacted      // Secondary (search, UserTweets, login)
  readonly proxyUrl: Option<string>
  readonly userAgent: string           // Default: Chrome 144 fingerprint
  readonly timeout: Duration           // Default: 30s
  readonly maxRetries: number          // Default: 3
  readonly interPageDelay: Duration    // Default: 1s (+ jitter)
}
```

Loaded from environment via `Effect.Config`. Sensitive values use `Config.redacted`.

---

## 9. Observability

Built in from the start, not bolted on later.

- Every service method wrapped with `Effect.withSpan("ServiceName.methodName")`
- `ApiRequest` execution annotated with endpoint, family, auth mode
- Rate limit events (delay, bucket exhaustion) logged via `Effect.logDebug`
- Auth events (token refresh, login flow steps) logged via `Effect.logInfo`
- Errors annotated with endpoint context via `Effect.annotateLogs`

This integrates with Effect's OpenTelemetry support — plug in a tracing layer and every API call is a span with endpoint metadata.

---

## 10. Testing

Test layers for every service:

```ts
TwitterHttpClient.Test  // Returns canned responses keyed by EndpointId
GuestAuth.Test          // Always has a valid token, no network
UserAuth.Test           // Always logged in, no network
CookieManager.Test      // In-memory jar
RateLimiter.Test        // No limits
ScraperStrategy.Test    // Pass-through, no retry, no delay
TwitterConfig.Test      // Hardcoded values
```

Test the strategy separately from the domain services. Test domain parsing separately from HTTP. The layer boundaries are the test boundaries.

Use `@effect/vitest` with `it.effect` for all tests. Use `TestClock` for retry/rate-limit timing tests.

---

## 11. Project Structure

```
src/
  index.ts                      — Public API re-exports
  strategy/
    ScraperStrategy.ts          — Tag, interface, Standard/Aggressive/Conservative/Test
  domain/
    Tweet.ts                    — Tweet schema, branded TweetId
    Profile.ts                  — Profile schema, branded Handle, UserId
    DirectMessage.ts            — DM schemas, DmPage, DmCursor
    TimelinePage.ts             — TimelinePage<T> for tweet/profile pagination
    SearchMode.ts               — Top | Latest | Photos | Videos | People
  errors/
    index.ts                    — All TaggedError definitions
  services/
    TweetService.ts             — Tag + Live layer
    ProfileService.ts
    SearchService.ts
    TimelineService.ts          — paginateTimeline, paginateDm
    DirectMessageService.ts
    TrendsService.ts
  infra/
    auth/
      GuestAuth.ts              — Guest token management
      UserAuth.ts               — Login flow, subtask handlers
      LoginFlow.ts              — Preflight, activation, subtask loop
    TwitterHttpClient.ts        — Middleware-composed, family-aware
    CookieManager.ts
    RateLimiter.ts
    Config.ts
    Fingerprint.ts              — Chrome UA, Sec-CH-UA, cipher randomization
  raw/
    types.ts                    — Raw GraphQL/REST response schemas
    endpoints.ts                — EndpointId, URLs, operation IDs, feature flags
    parsers.ts                  — Raw → domain transforms
    request.ts                  — ApiRequest builder, EndpointFamily, BearerTokenChoice
```

---

## 12. Changes from v1

| Issue | v1 Problem | v2 Fix |
|-------|-----------|--------|
| Strategy not swappable | `ScraperLive` baked in `Default` | Strategy is unsatisfied dependency; caller must provide |
| Guest/User conflation | `TwitterAuth.Guest (or .User)` as interchangeable | `GuestAuth` and `UserAuth` are distinct types; services declare which they need in `R` |
| Request layer too narrow | One GraphQL client | 5 endpoint families with typed `ApiRequest` carrying family, bearer token choice, auth mode |
| Strategy too vague | `execute(httpEffect)` | `execute(ApiRequest<T>)` with full endpoint metadata |
| Pagination too generic | One `Page<T>` with one cursor | `TimelinePage<T>` and `DmPage` with different cursor shapes and stop conditions |
| API inconsistency | Mixed `Effect<Stream>` / `Stream` / `Effect` | Paginated → `Stream<T, E, R>`, single-value → `Effect<T, E, R>`, no wrapping |
| Login oversimplified | "multi-step login flow" | Preflight → maybe-activate → no-CSRF → subtask loop with handler registry |
| Rate limiting optimistic | Assumed clean 429 responses | Handles `x-rate-limit-incoming == '0'` proactive warning, `BotDetectionError` for 399/TLS 404 |
| Observability deferred | Open question | `Effect.withSpan` on all service methods from day one |
| Testing deferred | Open question | Test layers defined for every service, `TestClock` for timing |
