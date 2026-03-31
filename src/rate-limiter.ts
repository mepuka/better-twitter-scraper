import { Clock, Duration, Effect, Layer, Ref, ServiceMap } from "effect";

import { RateLimitError } from "./errors";
import type { RateLimitBucket } from "./request";

interface BucketState {
  readonly blockedUntil?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly reset?: number;
}

const FALLBACK_RETRY_DELAY = Duration.seconds(1);

const parseHeaderNumber = (value: string | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const blockedUntilFromState = (state: BucketState) =>
  state.remaining === 0 && state.reset !== undefined
    ? state.reset * 1000
    : state.blockedUntil;

const applyHeaderState = (
  previous: BucketState | undefined,
  headers: Readonly<Record<string, string>>,
): BucketState | undefined => {
  const limit = parseHeaderNumber(headers["x-rate-limit-limit"]);
  const remaining = parseHeaderNumber(headers["x-rate-limit-remaining"]);
  const reset = parseHeaderNumber(headers["x-rate-limit-reset"]);

  if (
    limit === undefined &&
    remaining === undefined &&
    reset === undefined &&
    previous === undefined
  ) {
    return undefined;
  }

  const next: BucketState = {
    ...(previous ?? {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(reset !== undefined ? { reset } : {}),
  };

  const blockedUntil = blockedUntilFromState(next);

  if (blockedUntil !== undefined) {
    return {
      ...next,
      blockedUntil,
    };
  }

  if (remaining !== undefined && remaining > 0) {
    const { blockedUntil: _blockedUntil, ...rest } = next;
    return rest;
  }

  return next;
};

const updateBucketState = (
  current: Readonly<Record<string, BucketState>>,
  bucket: RateLimitBucket,
  nextState: BucketState | undefined,
) => {
  if (nextState === undefined) {
    return current;
  }

  return {
    ...current,
    [bucket]: nextState,
  };
};

export class RateLimiter extends ServiceMap.Service<
  RateLimiter,
  {
    readonly awaitReady: (
      bucket: RateLimitBucket,
    ) => Effect.Effect<void>;
    readonly noteRateLimit: (
      error: RateLimitError,
    ) => Effect.Effect<void>;
    readonly noteResponse: (
      options: {
        readonly bucket: RateLimitBucket;
        readonly headers: Readonly<Record<string, string>>;
      },
    ) => Effect.Effect<{
      readonly incomingExhausted: boolean;
    }>;
    readonly snapshot: (
      bucket: RateLimitBucket,
    ) => Effect.Effect<BucketState | null>;
  }
>()("@better-twitter-scraper/RateLimiter") {
  static get liveLayer() {
    return Layer.effect(
      RateLimiter,
      Effect.gen(function* () {
        const stateRef = yield* Ref.make({} as Readonly<Record<string, BucketState>>);

        const awaitReady = Effect.fn("RateLimiter.awaitReady")(function* (
          bucket: RateLimitBucket,
        ) {
          const current = yield* Ref.get(stateRef);
          const bucketState = current[bucket];

          if (!bucketState?.blockedUntil) {
            return;
          }

          const now = yield* Clock.currentTimeMillis;
          const waitMs = bucketState.blockedUntil - now;

          if (waitMs > 0) {
            yield* Effect.sleep(Duration.millis(waitMs));
          }
        });

        const noteResponse = Effect.fn("RateLimiter.noteResponse")(function* ({
          bucket,
          headers,
        }: {
          readonly bucket: RateLimitBucket;
          readonly headers: Readonly<Record<string, string>>;
        }) {
          yield* Ref.update(stateRef, (current) =>
            updateBucketState(
              current,
              bucket,
              applyHeaderState(current[bucket], headers),
            ),
          );

          return {
            incomingExhausted: headers["x-rate-limit-incoming"] === "0",
          } as const;
        });

        const noteRateLimit = Effect.fn("RateLimiter.noteRateLimit")(function* (
          error: RateLimitError,
        ) {
          const now = yield* Clock.currentTimeMillis;
          const blockedUntil =
            error.reset !== undefined
              ? error.reset * 1000
              : now + Duration.toMillis(FALLBACK_RETRY_DELAY);

          yield* Ref.update(stateRef, (current) =>
            updateBucketState(current, error.bucket, {
              blockedUntil,
              ...(error.limit !== undefined ? { limit: error.limit } : {}),
              ...(error.remaining !== undefined
                ? { remaining: error.remaining }
                : {}),
              ...(error.reset !== undefined ? { reset: error.reset } : {}),
            }),
          );
        });

        const snapshot = Effect.fn("RateLimiter.snapshot")(function* (
          bucket: RateLimitBucket,
        ) {
          const current = yield* Ref.get(stateRef);
          return current[bucket] ?? null;
        });

        return {
          awaitReady,
          noteRateLimit,
          noteResponse,
          snapshot,
        };
      }),
    );
  }
}
