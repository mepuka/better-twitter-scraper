import { Effect, Stream } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { paginateTimeline } from "../src/pagination";
import type { TimelinePage } from "../src/models";

describe("paginateTimeline", () => {
  it.effect("collects items across pages and stops at cursor end", () => {
    const pages: TimelinePage<string>[] = [
      { items: ["a", "b"], nextCursor: "c1", status: "has_more" },
      { items: ["c"], status: "at_end" },
    ];
    let call = 0;

    const stream = paginateTimeline({
      remaining: 10,
      fetchPage: () => Effect.succeed(pages[call++]!),
    });

    return Effect.gen(function* () {
      const result = yield* Stream.runCollect(stream);
      expect([...result]).toEqual(["a", "b", "c"]);
    });
  });

  it.effect("stops when remaining reaches zero", () => {
    const stream = paginateTimeline({
      remaining: 2,
      fetchPage: () =>
        Effect.succeed({
          items: ["a", "b", "c"],
          nextCursor: "c1",
          status: "has_more" as const,
        }),
    });

    return Effect.gen(function* () {
      const result = yield* Stream.runCollect(stream);
      expect([...result]).toEqual(["a", "b"]);
    });
  });

  it.effect("stops on duplicate cursor", () => {
    const pages: TimelinePage<string>[] = [
      { items: ["a"], nextCursor: "same", status: "has_more" },
      { items: ["b"], nextCursor: "same", status: "has_more" },
    ];
    let call = 0;

    const stream = paginateTimeline({
      remaining: 10,
      fetchPage: () => Effect.succeed(pages[call++]!),
    });

    return Effect.gen(function* () {
      const result = yield* Stream.runCollect(stream);
      expect([...result]).toEqual(["a", "b"]);
    });
  });

  it.effect("continues past an empty page when a fresh cursor is present", () => {
    const pages: TimelinePage<string>[] = [
      { items: [], nextCursor: "c1", status: "has_more" },
      { items: ["a"], status: "at_end" },
    ];
    let call = 0;

    const stream = paginateTimeline({
      remaining: 10,
      fetchPage: () => Effect.succeed(pages[call++]!),
    });

    return Effect.gen(function* () {
      const result = yield* Stream.runCollect(stream);
      expect([...result]).toEqual(["a"]);
    });
  });

  it.effect("returns empty stream when remaining is zero", () => {
    const stream = paginateTimeline({
      remaining: 0,
      fetchPage: () =>
        Effect.succeed({ items: ["a"], status: "at_end" as const }),
    });

    return Effect.gen(function* () {
      const result = yield* Stream.runCollect(stream);
      expect([...result]).toEqual([]);
    });
  });
});
