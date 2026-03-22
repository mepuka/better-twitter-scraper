import { Duration, Effect, Layer, Option, Ref, ServiceMap } from "effect";
import * as Cookies from "effect/unstable/http/Cookies";

const shouldDeleteCookie = (cookie: Cookies.Cookie) =>
  cookie.value.length === 0 ||
  (cookie.options?.maxAge !== undefined &&
    Duration.toMillis(Duration.fromInputUnsafe(cookie.options.maxAge)) <= 0) ||
  (cookie.options?.expires !== undefined &&
    cookie.options.expires.getTime() <= 0);

const snapshotStore = (cookies: Cookies.Cookies) =>
  Object.fromEntries(
    Object.entries(Cookies.toRecord(cookies)).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

export class CookieManager extends ServiceMap.Service<
  CookieManager,
  {
    readonly getCookieHeader: Effect.Effect<string>;
    readonly get: (name: string) => Effect.Effect<string | undefined>;
    readonly put: (name: string, value: string) => Effect.Effect<void>;
    readonly applySetCookies: (
      setCookies: Cookies.Cookies,
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
          Object.entries(initialCookies).reduce(
            (cookies, [name, value]) => Cookies.setUnsafe(cookies, name, value),
            Cookies.empty,
          ),
        );

        const get = (name: string) =>
          Ref.get(store).pipe(
            Effect.map((cookies) =>
              Option.getOrUndefined(Cookies.getValue(cookies, name)),
            ),
          );

        const put = (name: string, value: string) =>
          Ref.update(store, (cookies) => {
            return Cookies.setUnsafe(cookies, name, value);
          }).pipe(Effect.asVoid);

        const applySetCookies = (setCookies: Cookies.Cookies) =>
          Ref.update(store, (cookies) => {
            let next = cookies;
            for (const cookie of Object.values(setCookies.cookies)) {
              next = shouldDeleteCookie(cookie)
                ? Cookies.remove(next, cookie.name)
                : Cookies.setUnsafe(next, cookie.name, cookie.value, cookie.options);
            }
            return next;
          }).pipe(Effect.asVoid);

        const snapshot = Ref.get(store).pipe(
          Effect.map((cookies) => snapshotStore(cookies)),
        );

        const clear = Ref.set(store, Cookies.empty).pipe(Effect.asVoid);

        const getCookieHeader = Ref.get(store).pipe(
          Effect.map((cookies) => Cookies.toCookieHeader(cookies)),
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
