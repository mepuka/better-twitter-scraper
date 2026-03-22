import { Effect, Layer, Ref, ServiceMap } from "effect";

const parseSetCookie = (
  setCookie: string,
): readonly [string, string] | undefined => {
  const [pair] = setCookie.split(";");
  if (!pair) {
    return undefined;
  }

  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  if (name.length === 0) {
    return undefined;
  }

  return [name, value] as const;
};

const shouldDeleteCookie = (setCookie: string, value: string) =>
  value.length === 0 ||
  /(^|;\s*)max-age=0(?:;|$)/i.test(setCookie) ||
  /(^|;\s*)expires=thu,\s*01 jan 1970/i.test(setCookie);

const snapshotStore = (store: Map<string, string>) =>
  Object.fromEntries(
    [...store.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );

export class CookieManager extends ServiceMap.Service<
  CookieManager,
  {
    readonly getCookieHeader: Effect.Effect<string>;
    readonly get: (name: string) => Effect.Effect<string | undefined>;
    readonly put: (name: string, value: string) => Effect.Effect<void>;
    readonly applySetCookies: (
      setCookies: Iterable<string>,
    ) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<Readonly<Record<string, string>>>;
    readonly clear: Effect.Effect<void>;
  }
>()("@better-twitter-scraper/CookieManager") {
  static readonly liveLayer = CookieManager.makeLayer();

  static testLayer(initialCookies: Readonly<Record<string, string>> = {}) {
    return CookieManager.makeLayer(initialCookies);
  }

  private static makeLayer(initialCookies: Readonly<Record<string, string>> = {}) {
    return Layer.effect(
      CookieManager,
      Effect.gen(function* () {
        const store = yield* Ref.make(
          new Map<string, string>(Object.entries(initialCookies)),
        );

        const get = (name: string) =>
          Ref.get(store).pipe(Effect.map((cookies) => cookies.get(name)));

        const put = (name: string, value: string) =>
          Ref.update(store, (cookies) => {
            const next = new Map(cookies);
            next.set(name, value);
            return next;
          }).pipe(Effect.asVoid);

        const applySetCookies = (setCookies: Iterable<string>) =>
          Ref.update(store, (cookies) => {
            const next = new Map(cookies);

            for (const setCookie of setCookies) {
              const parsed = parseSetCookie(setCookie);
              if (!parsed) {
                continue;
              }

              const [name, value] = parsed;
              if (shouldDeleteCookie(setCookie, value)) {
                next.delete(name);
              } else {
                next.set(name, value);
              }
            }

            return next;
          }).pipe(Effect.asVoid);

        const snapshot = Ref.get(store).pipe(
          Effect.map((cookies) => snapshotStore(cookies)),
        );

        const clear = Ref.set(store, new Map<string, string>()).pipe(
          Effect.asVoid,
        );

        const getCookieHeader = snapshot.pipe(
          Effect.map((cookies) =>
            Object.entries(cookies)
              .map(([name, value]) => `${name}=${value}`)
              .join("; "),
          ),
        );

        return {
          getCookieHeader,
          get,
          put,
          applySetCookies,
          snapshot,
          clear,
        };
      }),
    );
  }
}
