# Pooled Scraper Strategy

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-session scraper with a pooled strategy that manages N authenticated sessions, selects the best one per-request based on rate limit state, and rotates to another session on session-specific failures.

**Architecture:** Each session is a "capsule" — a self-contained bundle of per-session state (cookies, guest auth, user auth helpers, rate limiter, XPFF). The pool holds capsules and selects among them. Shared infrastructure (config, HTTP transport, transaction ID) is borrowed, not owned. The pool implements the same `ScraperStrategy` interface, so all existing services work unchanged.

**Tech Stack:** Effect 4 beta (`Ref`, `Effect.gen`, `ServiceMap.Service`, `Layer`)

**Linear issues:** SKY-96 (redesigned)

---

## Design Decisions

### Session Capsule Ownership

| Component | Per-session | Why |
|-----------|------------|-----|
| CookieStore | Yes | Each session has its own auth cookies |
| GuestAuth (token refs + request helper) | Yes | Guest tokens are tied to cookie identity |
| UserRequestAuth (header builder) | Yes | Reads session cookies for auth headers |
| GuestRequestAuth (header builder) | Yes | Reads session cookies, guest token |
| RateLimiter | Yes | Rate limits are per-session |
| TwitterXpff | Yes | Derives key from session's `guest_id` cookie |
| TwitterConfig | Shared | Global settings |
| TwitterHttpClient | Shared | Transport is IP-level |
| TwitterTransactionId | Shared | Derives from x.com document, not session cookies |

### Rate Limit: Single Owner

The capsule's `RateLimiter` is the single source of truth. The pool does not maintain separate rate-limit records. To select the best session, the pool reads each capsule's `rateLimiter.snapshot(bucket)`. This eliminates dual-bookkeeping drift.

### Auth Gating: Strategy as Single Gatekeeper

The 5 domain services (search, tweets, lists, relationships, DMs) currently do their own `auth.isLoggedIn()` pre-checks. These are removed. The strategy is the single place that decides whether a request can be handled:

- **Pooled path:** `selectCandidates` does a live cookie check on each capsule
- **Non-pooled path:** `UserRequestAuth.headersFor` fails with `AuthenticationError` when required cookies (`ct0`, `auth_token`) are missing

Both paths produce the same error type. Services don't need to know which strategy implementation is behind them.

### Two Interfaces, Not One

```
ScraperStrategy = { execute }           // Request execution
SessionPoolManager = { addSession, sessionCount, snapshot }  // Pool management
```

`PooledScraperStrategy.layer(initialSessions)` provides both. Services depend only on `ScraperStrategy`. Consumers that manage the pool also depend on `SessionPoolManager`.

### Rotation Policy

Rotate to the next capsule on session-specific failures:
- `BotDetectionError` — session/IP flagged
- `AuthenticationError` — session cookies expired or revoked
- `GuestTokenError` — guest token rejected (after inner retry already attempted refresh)

Everything else (rate limits, transport errors, invalid responses, not-found) fails immediately — these are not session-specific.

Cap rotation attempts at `sessionCount` to prevent infinite loops.

### Bad Session Handling (v1)

**Explicit non-goal:** automatic quarantine or permanent removal. Failed sessions remain in the candidate pool. The live cookie check prevents truly dead sessions from being selected for user-auth requests. A cooldown/quarantine system is a v2 concern.

### Public API Change

`AuthPool` (exported from `index.ts`) is deleted and replaced by `SessionPoolManager`. This is a breaking change but acceptable since the library is unpublished.

---

## Tasks

### Task 1: Extract module-sized builders

Extract the construction logic from 5 modules into reusable factory functions. Both the existing Layer compositions and the new capsule factory will call these builders.

**Files:**
- Modify: `src/cookies.ts` — extract `createCookieStore()` returning the same interface as `CookieManager`
- Modify: `src/rate-limiter.ts` — extract `createRateLimiterInstance()` returning the same interface as `RateLimiter`
- Modify: `src/guest-auth.ts` — extract `createGuestAuth(cookies, config, http)` returning both the guest token manager and the guest request helper
- Modify: `src/user-auth.ts` — extract `createUserRequestAuth(cookies, config, transactionId, xpff)` returning the user request helper
- Modify: `src/xpff.ts` — extract `createXpff(cookies)` returning the XPFF header generator

**Rules:**
- Each builder is a plain `Effect.gen` function, not a Layer
- Each builder takes its dependencies as parameters
- The existing `Layer.effect` bodies call the new builders
- Builders are not exported from `index.ts` — they're internal wiring
- Don't rewrite behavior — move existing logic, parameterize dependencies
- Preserve test seams (e.g., `testLayer` still works)

**Step 1:** Extract `createCookieStore` from `cookies.ts`. The current `CookieManager` layer body becomes `Layer.effect(CookieManager, createCookieStore())`.

**Step 2:** Extract `createRateLimiterInstance` from `rate-limiter.ts`.

**Step 3:** Extract `createGuestAuth` from `guest-auth.ts`. Parameters: `{ cookies, config, http }`. Returns `{ guestAuth, guestRequestAuth }`.

**Step 4:** Extract `createXpff` from `xpff.ts`. Parameter: `{ getCookie: (name: string) => Effect<string | undefined> }`.

**Step 5:** Extract `createUserRequestAuth` from `user-auth.ts`. Parameters: `{ cookies, config, transactionId, xpff }`.

**Step 6:** Verify: `bunx tsc --noEmit && bun run test` — all tests must pass. Pure refactor.

**Step 7:** Commit.

---

### Task 2: Add live auth check to UserRequestAuth

Make `UserRequestAuth.headersFor` fail with `AuthenticationError` when required cookies are missing, so the strategy catches bad sessions without making a network call.

**Files:**
- Modify: `src/user-auth.ts` — add cookie presence check at the start of `headersFor`

**Implementation:**
```typescript
// At the start of headersFor:
const csrfToken = yield* cookies.get("ct0");
const authToken = yield* cookies.get("auth_token");
if (!csrfToken || !authToken) {
  return yield* new AuthenticationError({
    reason: `${request.endpointId} requires an authenticated session, but session cookies are missing or expired.`,
  });
}
```

This runs in both pooled and non-pooled paths since both use `UserRequestAuth`.

**Step 1:** Add the check. Import `AuthenticationError`.

**Step 2:** Verify tests pass — existing tests that provide valid cookies should be unaffected. Tests that don't restore cookies and call user-auth endpoints should now get `AuthenticationError` from the strategy instead of from the service pre-check.

**Step 3:** Commit.

---

### Task 3: Remove auth pre-checks from domain services

Remove the `auth.isLoggedIn()` checks and `UserAuth` dependency from the 5 domain services.

**Files:**
- Modify: `src/search.ts` — remove `UserAuth` import, `yield* UserAuth`, and `isLoggedIn` check
- Modify: `src/tweets.ts` — remove `UserAuth` import, `yield* UserAuth`, and all 3 `isLoggedIn` checks
- Modify: `src/lists.ts` — remove `UserAuth` import, `yield* UserAuth`, and `isLoggedIn` check
- Modify: `src/relationships.ts` — remove `UserAuth` import, `yield* UserAuth`, and `isLoggedIn` check
- Modify: `src/direct-messages.ts` — remove `UserAuth` import, `yield* UserAuth`, and `isLoggedIn` check

Each service's paginated methods currently wrap the auth check in `Stream.unwrap(Effect.gen(...))`. After removing the check, the `Effect.gen` may become unnecessary if it only existed for the check. Simplify where possible.

**Step 1:** Remove from all 5 services.

**Step 2:** Update test layers if any provided `UserAuth` solely for these services.

**Step 3:** Verify: `bunx tsc --noEmit && bun run test`. Some tests may need adjustment if they tested the "not logged in" error from the service level — those errors now come from the strategy level instead.

**Step 4:** Commit.

---

### Task 4: Build SessionCapsule type and factory

Create the session capsule — a runtime-constructed bundle of per-session state.

**Files:**
- Create: `src/session-capsule.ts`

**The type:**
```typescript
interface SessionCapsule {
  readonly id: number;
  readonly cookies: CookieStoreInstance;
  readonly guest: Option.Option<RequestAuthHelper>;
  readonly user: RequestAuthHelper;
  readonly rateLimiter: RateLimiterInstance;
  readonly canHandleUserAuth: () => Effect.Effect<boolean>;
}
```

Where `canHandleUserAuth` does a live check: `cookies.get("ct0")` and `cookies.get("auth_token")` both present.

**The factory:**
```typescript
export const createSessionCapsule = (
  id: number,
  serializedCookies: ReadonlyArray<SerializedCookie>,
  shared: {
    readonly config: TwitterConfigShape;
    readonly transactionId: TwitterTransactionId;
    readonly http: StrategyTransport;
  },
) => Effect.gen(function* () {
  const cookies = yield* createCookieStore();
  yield* cookies.restoreSerializedCookies(serializedCookies);
  const rateLimiter = yield* createRateLimiterInstance();
  const xpff = yield* createXpff({ getCookie: cookies.get });
  const { guestRequestAuth } = yield* createGuestAuth({
    cookies, config: shared.config, http: shared.http,
  });
  const userRequestAuth = yield* createUserRequestAuth({
    cookies, config: shared.config,
    transactionId: shared.transactionId, xpff,
  });

  return {
    id,
    cookies,
    guest: Option.some(guestRequestAuth),
    user: userRequestAuth,
    rateLimiter,
    canHandleUserAuth: () => Effect.gen(function* () {
      const ct0 = yield* cookies.get("ct0");
      const auth = yield* cookies.get("auth_token");
      return Boolean(ct0 && auth);
    }),
  };
});
```

**Step 1:** Create the file with type and factory.

**Step 2:** Write unit tests — create a capsule from test cookies, verify `canHandleUserAuth`, verify cookie state.

**Step 3:** Commit.

---

### Task 5: Build PooledScraperStrategy

The main pool service that selects capsules, dispatches requests, and rotates on failure.

**Files:**
- Create: `src/pooled-strategy.ts`
- Delete: `src/auth-pool.ts`
- Delete: `tests/auth-pool.test.ts`
- Modify: `index.ts` — remove `AuthPool` exports, add `PooledScraperStrategy`, `SessionPoolManager`

**SessionPoolManager interface:**
```typescript
export class SessionPoolManager extends ServiceMap.Service<
  SessionPoolManager,
  {
    readonly addSession: (cookies: ReadonlyArray<SerializedCookie>) => Effect.Effect<void>;
    readonly sessionCount: Effect.Effect<number>;
    readonly snapshot: Effect.Effect<ReadonlyArray<SessionSnapshot>>;
  }
>()("@better-twitter-scraper/SessionPoolManager") {}
```

**PooledScraperStrategy:**
```typescript
export class PooledScraperStrategy {
  static layer(
    initialSessions: ReadonlyArray<ReadonlyArray<SerializedCookie>> = [],
  ) {
    return Layer.effect(
      Layer.mergeAll(ScraperStrategy, SessionPoolManager),
      Effect.gen(function* () {
        // Resolve shared deps
        // Create capsules from initialSessions
        // Build execute + pool management
      }),
    );
  }
}
```

**Execute flow:**
1. `selectCandidates(request)` — filter capsules by auth capability (live cookie check for user-auth), sort by rate limit state for the request's bucket
2. Loop through candidates:
   - `createStrategyExecute(capsule.guest, capsule.user, capsule.cookies, shared.http, capsule.rateLimiter, ...)` 
   - Call `run(request)` via `Effect.either`
   - On success: return
   - On `BotDetectionError | AuthenticationError | GuestTokenError`: log, try next capsule
   - On anything else: fail immediately
3. If all capsules exhausted: fail with last error

**Tests:**
- Pool with 2 sessions, first gets bot-detected, second succeeds
- Pool with 2 sessions, first gets auth-rejected, second succeeds
- Pool with no sessions fails with AuthenticationError
- Pool selection prefers session with most rate limit headroom
- Rate limit error does NOT trigger rotation (fails immediately)
- Live auth check excludes capsules without user cookies

**Step 1:** Delete `src/auth-pool.ts` and `tests/auth-pool.test.ts`.

**Step 2:** Create `src/pooled-strategy.ts` with `SessionPoolManager` and `PooledScraperStrategy`.

**Step 3:** Update `index.ts` exports.

**Step 4:** Write tests.

**Step 5:** Verify: `bunx tsc --noEmit && bun run test`.

**Step 6:** Commit.

---

## Execution Order

```
Task 1 (extract builders) → Task 2 (live auth check) → Task 3 (remove pre-checks)
                                                              ↓
                                   Task 4 (session capsule) → Task 5 (pooled strategy)
```

Tasks 1-3 are sequential (each builds on the last). Task 4 depends on Task 1. Task 5 depends on Tasks 3 and 4.

Tasks 2 and 3 could theoretically be combined, but separating them makes the diff reviewable — one commit adds the new gate, the next removes the old one.
