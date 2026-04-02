import { Effect, Layer, Ref, ServiceMap } from "effect";

export class SignedInSessionRevision extends ServiceMap.Service<
  SignedInSessionRevision,
  {
    readonly current: Effect.Effect<number>;
    readonly bump: Effect.Effect<void>;
  }
>()("@better-twitter-scraper/SignedInSessionRevision") {
  static readonly liveLayer = Layer.effect(
    SignedInSessionRevision,
    Effect.gen(function* () {
      const revisionRef = yield* Ref.make(0);

      return {
        current: Ref.get(revisionRef),
        bump: Ref.update(revisionRef, (revision) => revision + 1).pipe(
          Effect.asVoid,
        ),
      };
    }),
  );

  static testLayer(initialRevision = 0) {
    return Layer.effect(
      SignedInSessionRevision,
      Effect.gen(function* () {
        const revisionRef = yield* Ref.make(initialRevision);

        return {
          current: Ref.get(revisionRef),
          bump: Ref.update(revisionRef, (revision) => revision + 1).pipe(
            Effect.asVoid,
          ),
        };
      }),
    );
  }
}
