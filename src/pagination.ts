import { Effect, Option, Random, Stream } from "effect";
import type { TimelinePage } from "./models";

interface PaginationState {
  readonly cursor: string | undefined;
  readonly remaining: number;
  readonly seenCursors: Set<string>;
}

export const paginateTimeline = <T, E>(options: {
  readonly remaining: number;
  readonly jitterMs?: number;
  readonly fetchPage: (
    cursor: string | undefined,
    remaining: number,
  ) => Effect.Effect<TimelinePage<T>, E>;
}): Stream.Stream<T, E> =>
  Stream.paginate<PaginationState, T, E>(
    {
      cursor: undefined,
      remaining: options.remaining,
      seenCursors: new Set<string>(),
    },
    (state) => {
      if (state.remaining <= 0) {
        return Effect.succeed([[], Option.none<PaginationState>()] as const);
      }

      return Effect.gen(function* () {
        if (state.cursor !== undefined && options.jitterMs && options.jitterMs > 0) {
          const jitter = yield* Random.nextIntBetween(0, options.jitterMs);
          yield* Effect.sleep(`${jitter} millis`);
        }
        const page = yield* options.fetchPage(state.cursor, state.remaining);
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
            ? Option.none<PaginationState>()
            : Option.some<PaginationState>({
                cursor: page.nextCursor,
                remaining,
                seenCursors: new Set(state.seenCursors).add(page.nextCursor),
              });

        return [items, next] as const;
      });
    },
  );
