import { Effect, Layer, ServiceMap } from "effect";

import { CookieManager } from "./cookies";
import { SessionPoolManager } from "./pooled-strategy";

export interface SessionStateInstance {
  readonly cacheKey: Effect.Effect<string>;
  readonly isLoggedIn: () => Effect.Effect<boolean>;
}

const cacheKeyFromSnapshot = (snapshot: Readonly<Record<string, string>>) =>
  `${snapshot.auth_token ?? ""}\u0000${snapshot.ct0 ?? ""}`;

export class TwitterSessionState extends ServiceMap.Service<
  TwitterSessionState,
  SessionStateInstance
>()("@better-twitter-scraper/TwitterSessionState") {
  static readonly liveLayer = Layer.effect(
    TwitterSessionState,
    Effect.gen(function* () {
      const cookies = yield* CookieManager;

      const cacheKey = cookies.snapshot.pipe(
        Effect.map((snapshot) => cacheKeyFromSnapshot(snapshot)),
      );

      const isLoggedIn = () =>
        cacheKey.pipe(Effect.map((value) => value !== "\u0000"));

      return {
        cacheKey,
        isLoggedIn,
      } satisfies SessionStateInstance;
    }),
  );

  static readonly pooledLayer = Layer.effect(
    TwitterSessionState,
    Effect.gen(function* () {
      const pool = yield* SessionPoolManager;

      const cacheKey = pool.snapshot.pipe(
        Effect.map((sessions) =>
          sessions
            .map((session) =>
              [
                session.id,
                session.hasUserAuth ? "1" : "0",
                session.cooldownUntil ?? "",
              ].join(":"),
            )
            .join("|"),
        ),
      );

      const isLoggedIn = () =>
        pool.snapshot.pipe(
          Effect.map((sessions) => sessions.some((session) => session.hasUserAuth)),
        );

      return {
        cacheKey,
        isLoggedIn,
      } satisfies SessionStateInstance;
    }),
  );
}
