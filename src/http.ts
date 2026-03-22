import { Effect, Layer, Ref, ServiceMap } from "effect";

import { TransportError } from "./errors";
import type { RawHttpRequest, RawHttpResponse } from "./request";

export interface ScriptedHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly setCookies?: readonly string[];
  readonly bodyText?: string;
  readonly json?: unknown;
}

export type HttpScript = Readonly<Record<string, readonly ScriptedHttpResponse[]>>;

export const httpRequestKey = (request: Pick<RawHttpRequest, "method" | "url">) =>
  `${request.method} ${request.url}`;

const normalizeHeaders = (headers: Headers): Readonly<Record<string, string>> => {
  const normalized: Record<string, string> = {};
  headers.forEach((value, key) => {
    normalized[key.toLowerCase()] = value;
  });
  return normalized;
};

const extractSetCookies = (headers: Headers): readonly string[] => {
  const candidate = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof candidate.getSetCookie === "function") {
    const setCookies = candidate.getSetCookie();
    if (setCookies.length > 0) {
      return setCookies;
    }
  }

  const singleHeader = headers.get("set-cookie");
  return singleHeader ? [singleHeader] : [];
};

const toRawHttpResponse = (response: ScriptedHttpResponse): RawHttpResponse => ({
  status: response.status,
  headers: Object.fromEntries(
    Object.entries(response.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  ),
  setCookies: response.setCookies ?? [],
  bodyText:
    response.bodyText ??
    (response.json === undefined ? "" : JSON.stringify(response.json)),
});

const cloneScript = (script: HttpScript): Record<string, ScriptedHttpResponse[]> =>
  Object.fromEntries(
    Object.entries(script).map(([key, responses]) => [key, [...responses]]),
  );

export class TwitterHttpClient extends ServiceMap.Service<
  TwitterHttpClient,
  {
    readonly execute: (
      request: RawHttpRequest,
    ) => Effect.Effect<RawHttpResponse, TransportError>;
  }
>()("@better-twitter-scraper/TwitterHttpClient") {
  static readonly liveLayer = Layer.succeed(TwitterHttpClient, {
    execute: Effect.fn("TwitterHttpClient.execute")(function* (
      request: RawHttpRequest,
    ) {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
          }),
        catch: (error) =>
          new TransportError({
            url: request.url,
            reason: "Network request failed",
            error,
          }),
      });

      const bodyText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (error) =>
          new TransportError({
            url: request.url,
            reason: "Failed to read response body",
            error,
          }),
      });

      return {
        status: response.status,
        headers: normalizeHeaders(response.headers),
        setCookies: extractSetCookies(response.headers),
        bodyText,
      };
    }),
  });

  static scriptedLayer(script: HttpScript) {
    return Layer.effect(
      TwitterHttpClient,
      Effect.gen(function* () {
        const state = yield* Ref.make(cloneScript(script));

        const execute = Effect.fn("TwitterHttpClient.execute")(function* (
          request: RawHttpRequest,
        ) {
          const key = httpRequestKey(request);

          const scriptedResponse = yield* Ref.modify(state, (current) => {
            const responses = current[key];
            if (!responses || responses.length === 0) {
              return [undefined, current] as const;
            }

            const [nextResponse, ...remaining] = responses;
            return [
              nextResponse,
              {
                ...current,
                [key]: remaining,
              },
            ] as const;
          });

          if (!scriptedResponse) {
            return yield* new TransportError({
              url: request.url,
              reason: `No scripted response for ${key}`,
              error: new Error(`No scripted response for ${key}`),
            });
          }

          return toRawHttpResponse(scriptedResponse);
        });

        return { execute };
      }),
    );
  }
}
