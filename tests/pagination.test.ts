import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { paginateTimeline } from "../src/pagination";
import type { TimelinePage } from "../src/models";

describe("paginateTimeline", () => {
  it("collects items across pages and stops at cursor end", async () => {
    const pages: TimelinePage<string>[] = [
      { items: ["a", "b"], nextCursor: "c1", status: "has_more" },
      { items: ["c"], status: "at_end" },
    ];
    let call = 0;

    const stream = paginateTimeline({
      remaining: 10,
      fetchPage: () => Effect.succeed(pages[call++]!),
    });

    const result = await Effect.runPromise(Stream.runCollect(stream));
    expect([...result]).toEqual(["a", "b", "c"]);
  });

  it("stops when remaining reaches zero", async () => {
    const stream = paginateTimeline({
      remaining: 2,
      fetchPage: () =>
        Effect.succeed({
          items: ["a", "b", "c"],
          nextCursor: "c1",
          status: "has_more" as const,
        }),
    });

    const result = await Effect.runPromise(Stream.runCollect(stream));
    expect([...result]).toEqual(["a", "b"]);
  });

  it("stops on duplicate cursor", async () => {
    const pages: TimelinePage<string>[] = [
      { items: ["a"], nextCursor: "same", status: "has_more" },
      { items: ["b"], nextCursor: "same", status: "has_more" },
    ];
    let call = 0;

    const stream = paginateTimeline({
      remaining: 10,
      fetchPage: () => Effect.succeed(pages[call++]!),
    });

    const result = await Effect.runPromise(Stream.runCollect(stream));
    expect([...result]).toEqual(["a", "b"]);
  });

  it("returns empty stream when remaining is zero", async () => {
    const stream = paginateTimeline({
      remaining: 0,
      fetchPage: () =>
        Effect.succeed({ items: ["a"], status: "at_end" as const }),
    });

    const result = await Effect.runPromise(Stream.runCollect(stream));
    expect([...result]).toEqual([]);
  });
});
