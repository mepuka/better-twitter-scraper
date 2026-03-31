import { Data, Effect, Layer, Ref } from "effect";
import initCycleTLS, { type CycleTLSClient } from "cycletls";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import {
  CHROME_HEADER_ORDER,
  CHROME_HTTP2_FINGERPRINT,
  CHROME_JA3,
  CHROME_JA4R,
  CHROME_USER_AGENT,
} from "./chrome-fingerprint";
import { httpClientRequestUrl } from "./request";

export interface ScriptedHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly setCookies?: readonly string[];
  readonly bodyText?: string;
  readonly json?: unknown;
}

export type HttpScript = Readonly<Record<string, readonly ScriptedHttpResponse[]>>;

class CycleTlsInitError extends Data.TaggedError("CycleTlsInitError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

const requestUrl = (
  request: HttpClientRequest.HttpClientRequest | Pick<HttpClientRequest.HttpClientRequest, "url">,
) => ("urlParams" in request ? httpClientRequestUrl(request) : request.url);

export const httpRequestKey = (
  request:
    | HttpClientRequest.HttpClientRequest
    | Pick<HttpClientRequest.HttpClientRequest, "method" | "url">,
) => `${request.method} ${requestUrl(request)}`;

const toBodyText = (response: ScriptedHttpResponse) =>
  response.bodyText ??
  (response.json === undefined ? "" : JSON.stringify(response.json));

const toWebResponse = (response: ScriptedHttpResponse) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    headers.set(key, value);
  }

  for (const setCookie of response.setCookies ?? []) {
    headers.append("set-cookie", setCookie);
  }

  return new Response(toBodyText(response), {
    status: response.status,
    headers,
  });
};

const cloneScript = (script: HttpScript): Record<string, ScriptedHttpResponse[]> =>
  Object.fromEntries(
    Object.entries(script).map(([key, responses]) => [key, [...responses]]),
  );

type FetchHeadersInput = RequestInit["headers"];
type FetchBodyInput = RequestInit["body"];

const toHeaderRecord = (headersInit?: FetchHeadersInput) => {
  const headers = new Headers(headersInit);
  const record: Record<string, string> = {};

  headers.forEach((value, key) => {
    record[key] = value;
  });

  return record;
};

const toUrlEncodedForm = (body: FormData) => {
  const params = new URLSearchParams();

  for (const [key, value] of body.entries()) {
    if (typeof value !== "string") {
      throw new Error("CycleTLS transport only supports string form fields.");
    }
    params.append(key, value);
  }

  return params;
};

const toCycleTlsBody = async (
  body: FetchBodyInput,
  headers: Record<string, string>,
) => {
  if (body == null) {
    return undefined;
  }

  if (typeof body === "string" || body instanceof URLSearchParams) {
    return body;
  }

  if (body instanceof FormData) {
    if (!("content-type" in headers)) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    return toUrlEncodedForm(body);
  }

  if (body instanceof Blob) {
    return body.text();
  }

  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }

  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }

  throw new Error("CycleTLS transport does not support streaming request bodies.");
};

const toFetchResponse = async (response: Awaited<ReturnType<CycleTLSClient>>) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, String(item));
      }
    } else if (value !== undefined && value !== null) {
      headers.append(key, String(value));
    }
  }

  const bodyText =
    typeof response.text === "function"
      ? await response.text()
      : typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data ?? "");

  return new Response(bodyText, {
    status: response.status,
    headers,
  });
};

const makeCycleTlsFetch = (client: CycleTLSClient): typeof globalThis.fetch =>
  Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = toHeaderRecord(init?.headers);
      const body = await toCycleTlsBody(init?.body, headers);

      const response = await client(
        url,
        {
          headers,
          responseType: "text",
          ja3: CHROME_JA3,
          ja4r: CHROME_JA4R,
          http2Fingerprint: CHROME_HTTP2_FINGERPRINT,
          headerOrder: [...CHROME_HEADER_ORDER],
          orderAsProvided: true,
          disableGrease: false,
          userAgent: headers["user-agent"] ?? CHROME_USER_AGENT,
          ...(body === undefined ? {} : { body }),
        },
        method.toLowerCase() as
          | "delete"
          | "get"
          | "head"
          | "options"
          | "patch"
          | "post"
          | "put",
      );

      return toFetchResponse(response);
    },
    {
      preconnect:
        typeof globalThis.fetch.preconnect === "function"
          ? globalThis.fetch.preconnect.bind(globalThis.fetch)
          : (() => {}) as typeof globalThis.fetch.preconnect,
    },
  );

const cycleTlsFetchLayer = Layer.effect(
  FetchHttpClient.Fetch,
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => initCycleTLS(),
      catch: (cause) =>
        new CycleTlsInitError({
          reason:
            cause instanceof Error
              ? `Failed to initialize CycleTLS: ${cause.message}`
              : "Failed to initialize CycleTLS.",
          cause,
        }),
    }),
    (client) =>
      Effect.tryPromise({
        try: () => client.exit(),
        catch: () => undefined,
      }).pipe(Effect.orDie),
  ).pipe(Effect.map(makeCycleTlsFetch)),
);

export class TwitterHttpClient {
  static readonly liveLayer = FetchHttpClient.layer;
  static readonly cycleTlsLayer = FetchHttpClient.layer.pipe(
    Layer.provideMerge(cycleTlsFetchLayer),
  );

  static scriptedLayer(script: HttpScript) {
    return Layer.effect(
      HttpClient.HttpClient,
      Effect.gen(function* () {
        const state = yield* Ref.make(cloneScript(script));

        return HttpClient.make((request) =>
          Effect.gen(function* () {
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
              return yield* new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  description: `No scripted response for ${key}`,
                }),
              });
            }

            return HttpClientResponse.fromWeb(request, toWebResponse(scriptedResponse));
          }),
        );
      }),
    );
  }
}
