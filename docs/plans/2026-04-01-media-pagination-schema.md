# Media Parsing, Pagination Helper & Schema Domain Models

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add media parsing to timeline tweets, extract a shared pagination helper, and consolidate the Tweet/Profile domain models onto Schema.Class — folding SKY-85, SKY-87, SKY-91, SKY-97, and SKY-101 into a single cohesive batch.

**Architecture:** We already have `TweetPhoto`, `TweetVideo`, `TweetPlace`, and `parseMediaGroups` in `tweet-detail-builder.ts`. Rather than duplicating these for the timeline parser, we extract shared raw types and the media parser into a new `src/api-types.ts` module, then reuse them in both `parsers.ts` and `tweet-detail-builder.ts`. The timeline `Tweet` and `Profile` in `models.ts` graduate from plain TS interfaces to `Schema.Class` instances matching the pattern in `tweet-detail-model.ts`. The duplicated pagination logic across 5 services gets extracted into a generic `paginateTimeline` helper.

**Tech Stack:** Effect 4 beta (`Schema.Class`, `Stream.paginate`, `Schema.optionalKey`), vitest

**Linear issues:** SKY-85, SKY-87, SKY-91, SKY-97, SKY-101

---

### Task 1: Extract shared raw API types into `src/api-types.ts`

Both `parsers.ts` and `tweet-detail-builder.ts` define their own copies of `LegacyTweetRaw`, `MentionRaw`, `UrlEntityRaw`, `TimelineResultRaw`, `TimelineEntryItemContentRaw`, `TimelineMediaExtendedRaw`, and `CoreUserRaw`. Extract the superset into a shared file.

**Files:**
- Create: `src/api-types.ts`
- Modify: `src/parsers.ts` — remove duplicate interfaces, import from `api-types.ts`
- Modify: `src/tweet-detail-builder.ts` — remove duplicate interfaces, import from `api-types.ts`

**Step 1: Create `src/api-types.ts`**

Extract and merge all shared raw response interfaces. The superset lives in `tweet-detail-builder.ts` (it has `extended_entities`, `place`, `bookmark_count`, `edit_control`, etc. that `parsers.ts` was missing). Use the `tweet-detail-builder.ts` versions as the canonical source, since they're more complete.

Interfaces to include:
- `UrlEntityRaw`
- `MentionRaw`
- `TimelineMediaExtendedRaw`
- `LegacyTweetRaw` (the builder's version, which includes `extended_entities`, `place`, `bookmark_count`, `ext_views`, `retweeted_status_result`)
- `CoreUserRaw`
- `LegacyUserRaw` (merge both — builder has `pinned_tweet_ids_str`, parsers has the full profile fields. Export both: `LegacyTweetUserRaw` for the slimmer tweet-embedded user, and `LegacyProfileUserRaw` for the full profile version)
- `TimelineResultRaw` (builder's version, which has `edit_control`, `quoted_status_result`)
- `TimelineEntryItemContentRaw`
- `TimelineEntryRaw`
- `TimelineInstructionRaw`

**Step 2: Update `src/parsers.ts`**

Remove all duplicated interfaces at lines 6–143. Add `import type { ... } from "./api-types"`. The `parsers.ts` versions are a subset — the builder's superset is backward compatible. Also remove the parsers-only types that are NOT shared (e.g., `SearchEntryItemContentRaw`, `SearchEntryRaw`, `SearchInstructionRaw`, response wrappers) — those stay in `parsers.ts`.

**Step 3: Update `src/tweet-detail-builder.ts`**

Remove all duplicated interfaces at lines 14–156. Add `import type { ... } from "./api-types"`. Keep the `tweet-detail-builder.ts`-only types like `TweetDetailResponse` in place.

**Step 4: Run type check and tests**

Run: `bunx tsc --noEmit && bun run test`
Expected: All pass — no behavioral change, pure refactor.

**Step 5: Commit**

```
git add src/api-types.ts src/parsers.ts src/tweet-detail-builder.ts
git commit -m "refactor: extract shared raw API types into api-types.ts (SKY-97 partial)"
```

---

### Task 2: Extract `parseMediaGroups` and `parseTimestamp` into shared utilities

**Files:**
- Create: `src/parse-utils.ts`
- Modify: `src/parsers.ts` — remove `parseTimestamp`, import from `parse-utils.ts`
- Modify: `src/tweet-detail-builder.ts` — remove `parseTimestamp`, `parseMediaGroups`, `reconstructTweetHtml`, import from `parse-utils.ts`

**Step 1: Create `src/parse-utils.ts`**

Move from `tweet-detail-builder.ts`:
- `parseMediaGroups` (lines 271–333) — returns `{ photos, videos, sensitiveContent }`
- `reconstructTweetHtml` (lines 344–386) — builds HTML from text + entities + media
- `parseTimestamp` (either copy — they're identical)

These are pure functions with no service dependencies. Import `TweetPhoto`, `TweetVideo` from `tweet-detail-model.ts` and `TimelineMediaExtendedRaw`, `LegacyTweetRaw` from `api-types.ts`.

Also move the regex constants used by `reconstructTweetHtml`:
- `HASH_TAG_RE`, `CASH_TAG_RE`, `USERNAME_RE`, `TWITTER_URL_RE`
- `linkHashtagHtml`, `linkCashtagHtml`, `linkUsernameHtml`

**Step 2: Update imports in `parsers.ts` and `tweet-detail-builder.ts`**

Replace local definitions with imports from `parse-utils.ts`.

**Step 3: Run type check and tests**

Run: `bunx tsc --noEmit && bun run test`
Expected: All pass.

**Step 4: Commit**

```
git add src/parse-utils.ts src/parsers.ts src/tweet-detail-builder.ts
git commit -m "refactor: extract parseMediaGroups, parseTimestamp into shared utils (SKY-97)"
```

---

### Task 3: Add media fields to timeline `Tweet` model and parser

**Files:**
- Modify: `src/models.ts` — add `photos`, `videos`, `sensitiveContent`, `html`, `bookmarkCount`, `isEdited`, `isSelfThread`, `isPinned` to `Tweet`
- Modify: `src/parsers.ts` — update `parseTweet` to parse `extended_entities.media` and new fields
- Modify: `tests/fixtures.ts` — add media to `tweetResult` helper

**Step 1: Write the failing test**

Add to `tests/slice1.test.ts` (or a new `tests/media.test.ts`):

```typescript
import { parseTweet } from "../src/parsers"; // export if needed

// Test via the full pipeline — add media to a fixture tweet and
// verify it appears in the parsed output.
```

Actually, the cleanest approach is to add media to an existing fixture tweet and assert it in an existing integration test. Update the `tweetResult` helper in `tests/fixtures.ts` to accept optional `photos` and `videos`, with `extended_entities.media` in the output. Then assert in the existing `slice1.test.ts` tweet fetch test that `photos`/`videos` are present.

**Step 2: Update `tests/fixtures.ts` `tweetResult` helper**

Add optional `photos` and `videos` parameters (matching the existing `DetailTweetInput` pattern). Generate `extended_entities.media` from them. Add media to the first tweet in `tweetsPageOneFixture`:

```typescript
tweetEntry({
  id: "tweet-1",
  text: "First tweet",
  ...
  photos: [{ id: "p1", url: "https://pbs.twimg.com/media/tweet1.jpg", tcoUrl: "https://t.co/p1" }],
  videos: [{ id: "v1", preview: "https://pbs.twimg.com/media/tweet1-vid.jpg", tcoUrl: "https://t.co/v1", url: "https://video.twimg.com/tweet1.mp4" }],
})
```

**Step 3: Update `src/models.ts` `Tweet` interface**

Add these fields:

```typescript
readonly photos: readonly TweetPhoto[];
readonly videos: readonly TweetVideo[];
readonly sensitiveContent?: boolean;
readonly html?: string;
readonly bookmarkCount?: number;
readonly isEdited?: boolean;
readonly isSelfThread?: boolean;
readonly isPinned?: boolean;
```

Import `TweetPhoto` and `TweetVideo` from `tweet-detail-model.ts`.

**Step 4: Update `parseTweet` in `src/parsers.ts`**

After extracting `legacy`, call `parseMediaGroups(legacy.extended_entities?.media ?? [])` to get `{ photos, videos, sensitiveContent }`. Call `reconstructTweetHtml(legacy, text, photos, videos)` to build HTML. Add these to the returned object.

For `isEdited`: Check if `result?.edit_control?.edit_control_initial?.edit_tweet_ids` has length > 1.
For `isSelfThread`: Check `entryId` or other markers.  
For `isPinned`: Check if `entryId` starts with `"pinned-tweet-"`.
For `bookmarkCount`: Access `legacy.bookmark_count`.

**Step 5: Run test to verify it passes**

Run: `bunx tsc --noEmit && bun run test`
Expected: All pass. Existing tests that don't include media in fixtures will have `photos: []`, `videos: []`.

**Step 6: Add a dedicated media parsing assertion**

In the existing `slice1.test.ts` test that fetches tweets, add assertions for the media fields on the first tweet.

**Step 7: Run tests again**

Run: `bun run test`
Expected: All pass.

**Step 8: Commit**

```
git add src/models.ts src/parsers.ts tests/fixtures.ts tests/slice1.test.ts
git commit -m "feat: add media parsing (photos, videos, GIFs) to timeline tweets (SKY-85, SKY-101)"
```

---

### Task 4: Extract generic `paginateTimeline` helper

**Files:**
- Create: `src/pagination.ts`
- Modify: `src/public.ts` — replace inline pagination with helper
- Modify: `src/tweets.ts` — replace inline pagination with helper
- Modify: `src/search.ts` — replace inline pagination with helper
- Modify: `src/relationships.ts` — replace inline pagination with helper
- Modify: `src/lists.ts` — replace inline pagination with helper

**Step 1: Create `src/pagination.ts`**

```typescript
import { Effect, Option, Stream } from "effect";
import type { TimelinePage } from "./models";

interface PaginationState {
  readonly cursor?: string;
  readonly remaining: number;
  readonly seenCursors: ReadonlySet<string>;
}

export const paginateTimeline = <S extends PaginationState, T, E>(options: {
  readonly initialState: S;
  readonly fetchPage: (state: S) => Effect.Effect<TimelinePage<T>, E>;
  readonly nextState: (
    state: S,
    cursor: string,
    remaining: number,
    seenCursors: ReadonlySet<string>,
  ) => S;
}): Stream.Stream<T, E> =>
  Stream.paginate<S, T, E>(options.initialState, (state) => {
    if (state.remaining <= 0) {
      return Effect.succeed([[], Option.none<S>()] as const);
    }

    return Effect.gen(function* () {
      const page = yield* options.fetchPage(state);
      const items = page.items.slice(0, state.remaining);
      const duplicateCursor =
        page.nextCursor !== undefined &&
        state.seenCursors.has(page.nextCursor);
      const remaining = state.remaining - items.length;

      const next =
        items.length === 0 ||
        !page.nextCursor ||
        page.status === "at_end" ||
        duplicateCursor ||
        remaining <= 0
          ? Option.none<S>()
          : Option.some(
              options.nextState(
                state,
                page.nextCursor,
                remaining,
                new Set(state.seenCursors).add(page.nextCursor),
              ),
            );

      return [items, next] as const;
    });
  });
```

**Step 2: Write a unit test for the pagination helper**

Create `tests/pagination.test.ts`:

```typescript
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { paginateTimeline } from "../src/pagination";

describe("paginateTimeline", () => {
  it("collects items across pages and stops at cursor end", async () => {
    const pages = [
      { items: ["a", "b"], nextCursor: "c1", status: "has_more" as const },
      { items: ["c"], status: "at_end" as const },
    ];
    let call = 0;

    const stream = paginateTimeline({
      initialState: { remaining: 10, seenCursors: new Set<string>() },
      fetchPage: () => Effect.succeed(pages[call++]!),
      nextState: (_s, cursor, remaining, seenCursors) => ({
        cursor,
        remaining,
        seenCursors,
      }),
    });

    const result = await Effect.runPromise(Stream.runCollect(stream));
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("stops when remaining reaches zero", async () => {
    const stream = paginateTimeline({
      initialState: { remaining: 2, seenCursors: new Set<string>() },
      fetchPage: () =>
        Effect.succeed({
          items: ["a", "b", "c"],
          nextCursor: "c1",
          status: "has_more" as const,
        }),
      nextState: (_s, cursor, remaining, seenCursors) => ({
        cursor,
        remaining,
        seenCursors,
      }),
    });

    const result = await Effect.runPromise(Stream.runCollect(stream));
    expect(result).toEqual(["a", "b"]);
  });

  it("stops on duplicate cursor", async () => {
    const pages = [
      { items: ["a"], nextCursor: "same", status: "has_more" as const },
      { items: ["b"], nextCursor: "same", status: "has_more" as const },
    ];
    let call = 0;

    const stream = paginateTimeline({
      initialState: { remaining: 10, seenCursors: new Set<string>() },
      fetchPage: () => Effect.succeed(pages[call++]!),
      nextState: (_s, cursor, remaining, seenCursors) => ({
        cursor,
        remaining,
        seenCursors,
      }),
    });

    const result = await Effect.runPromise(Stream.runCollect(stream));
    expect(result).toEqual(["a", "b"]);
  });
});
```

**Step 3: Run test to verify it passes**

Run: `bun run test -- tests/pagination.test.ts`
Expected: All 3 tests pass.

**Step 4: Replace inline pagination in all 5 services**

For each service, replace the `Stream.paginate(...)` block with a call to `paginateTimeline(...)`. The `nextState` callback is the only part that varies (to carry service-specific state like `userId`, `listId`, `query`).

Example for `public.ts`:
```typescript
return paginateTimeline({
  initialState: { userId, remaining: limit, seenCursors: new Set<string>() },
  fetchPage: (state) => fetchTweetsPage(state.userId, state.remaining, state.cursor),
  nextState: (state, cursor, remaining, seenCursors) => ({
    ...state, cursor, remaining, seenCursors,
  }),
});
```

**Step 5: Run full test suite**

Run: `bunx tsc --noEmit && bun run test`
Expected: All 106+ tests pass.

**Step 6: Commit**

```
git add src/pagination.ts tests/pagination.test.ts src/public.ts src/tweets.ts src/search.ts src/relationships.ts src/lists.ts
git commit -m "refactor: extract paginateTimeline helper, eliminating 5x duplication (SKY-87)"
```

---

### Task 5: Migrate `Tweet` and `Profile` to `Schema.Class` (optional stretch)

> This task is the largest and most invasive. It can be done separately if time is tight.

**Files:**
- Modify: `src/models.ts` — convert `Tweet`, `Profile`, `Mention` from interfaces to `Schema.Class`
- Modify: `src/parsers.ts` — update `parseTweet` and `parseUserProfile` to construct `Schema.Class` instances (using `new Tweet({...})`)
- Modify: all test files that reference `Tweet` or `Profile` fields

**Step 1: Convert `Mention` to `Schema.Class`**

```typescript
export class Mention extends Schema.Class<Mention>("Mention")({
  id: Schema.String,
  username: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
}) {}
```

**Step 2: Convert `Tweet` to `Schema.Class`**

Use `Schema.optionalKey` for optional fields. Required fields (`id`, `hashtags`, `mentions`, `urls`, `isQuoted`, `isReply`, `isRetweet`, `photos`, `videos`) use direct schemas.

**Step 3: Convert `Profile` to `Schema.Class`**

Same pattern — all currently-optional fields use `Schema.optionalKey`.

**Step 4: Update parsers to use `new Tweet({...})` and `new Profile({...})`**

The `as Tweet` / `as Profile` casts in `parsers.ts` get replaced with direct Schema.Class construction. The constructor validates types at construction time.

**Step 5: Run tests**

Run: `bunx tsc --noEmit && bun run test`
Expected: All pass. Some tests that do `expect(tweet).toEqual({...})` may need adjustment since `Schema.Class` instances have a different prototype.

**Step 6: Commit**

```
git add src/models.ts src/parsers.ts
git commit -m "refactor: migrate Tweet/Profile to Schema.Class for runtime validation (SKY-91)"
```

---

## Execution Order & Dependencies

```
Task 1 (shared types) ──→ Task 2 (shared utils) ──→ Task 3 (media parsing)
                                                          ↓
Task 4 (pagination helper) ← independent, can run in parallel with 1-3
                                                          ↓
                                                    Task 5 (Schema.Class) ← depends on 3
```

Tasks 1-3 are sequential (each builds on the last). Task 4 is independent and can be done in parallel. Task 5 depends on Task 3 (the media fields need to exist before converting to Schema.Class).
