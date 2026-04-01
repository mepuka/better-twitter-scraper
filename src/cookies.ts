import { Duration, Effect, Layer, Option, Ref, ServiceMap } from "effect";
import * as Cookies from "effect/unstable/http/Cookies";

export interface SerializedCookieObject {
  readonly key?: string;
  readonly name?: string;
  readonly value?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
}

export type SerializedCookie = string | SerializedCookieObject;

const shouldDeleteCookie = (cookie: Cookies.Cookie) =>
  cookie.value.length === 0 ||
  (cookie.options?.maxAge !== undefined &&
    Duration.toMillis(Duration.fromInputUnsafe(cookie.options.maxAge)) <= 0) ||
  (cookie.options?.expires !== undefined &&
    cookie.options.expires.getTime() <= 0);

const normalizeSerializedCookie = (serializedCookie: SerializedCookie) => {
  if (typeof serializedCookie === "string") {
    return serializedCookie;
  }

  const name = serializedCookie.name ?? serializedCookie.key;
  if (!name || serializedCookie.value === undefined) {
    return undefined;
  }

  const parts = [`${name}=${serializedCookie.value}`];
  if (serializedCookie.domain) {
    parts.push(
      `Domain=${
        serializedCookie.domain.startsWith(".")
          ? serializedCookie.domain.slice(1)
          : serializedCookie.domain
      }`,
    );
  }
  if (serializedCookie.path) {
    parts.push(`Path=${serializedCookie.path}`);
  }
  if (serializedCookie.httpOnly) {
    parts.push("HttpOnly");
  }
  if (serializedCookie.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
};

const snapshotStore = (cookies: Cookies.Cookies) =>
  Object.fromEntries(
    Object.entries(Cookies.toRecord(cookies)).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

export type CookieStoreInstance = {
  readonly getCookieHeader: Effect.Effect<string>;
  readonly get: (name: string) => Effect.Effect<string | undefined>;
  readonly put: (name: string, value: string) => Effect.Effect<void>;
  readonly applySetCookies: (
    setCookies: Cookies.Cookies,
  ) => Effect.Effect<void>;
  readonly restoreSerializedCookies: (
    serializedCookies: Iterable<SerializedCookie>,
  ) => Effect.Effect<void>;
  readonly serializeCookies: Effect.Effect<readonly string[]>;
  readonly snapshot: Effect.Effect<Readonly<Record<string, string>>>;
  readonly clear: Effect.Effect<void>;
};

export const createCookieStore = (
  initialCookies: Readonly<Record<string, string>> = {},
) =>
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

    const restoreSerializedCookies = (
      serializedCookies: Iterable<SerializedCookie>,
    ) =>
      Ref.update(store, (cookies) => {
        let next = cookies;

        for (const serializedCookie of serializedCookies) {
          const normalizedCookie = normalizeSerializedCookie(serializedCookie);
          if (!normalizedCookie) {
            continue;
          }

          const parsedCookies = Cookies.fromSetCookie(normalizedCookie);
          for (const cookie of Object.values(parsedCookies.cookies)) {
            next = shouldDeleteCookie(cookie)
              ? Cookies.remove(next, cookie.name)
              : Cookies.setUnsafe(next, cookie.name, cookie.value, cookie.options);
          }
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

    const serializeCookies = Ref.get(store).pipe(
      Effect.map((cookies) => Cookies.toSetCookieHeaders(cookies)),
    );

    return {
      getCookieHeader,
      get,
      put,
      applySetCookies,
      restoreSerializedCookies,
      serializeCookies,
      snapshot,
      clear,
    } satisfies CookieStoreInstance;
  });

export class CookieManager extends ServiceMap.Service<
  CookieManager,
  CookieStoreInstance
>()("@better-twitter-scraper/CookieManager") {
  static readonly liveLayer = Layer.effect(CookieManager, createCookieStore());

  static testLayer(initialCookies: Readonly<Record<string, string>> = {}) {
    return Layer.effect(CookieManager, createCookieStore(initialCookies));
  }
}
