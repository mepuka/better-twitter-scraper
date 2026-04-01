import { Data, Effect, Layer, Ref, ServiceMap } from "effect";
import initCycleTLS, { type CycleTLSClient } from "cycletls";
import * as Cookies from "effect/unstable/http/Cookies";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import {
  CHROME_HEADER_ORDER,
  CHROME_HTTP2_FINGERPRINT,
  CHROME_JA3,
  CHROME_JA4R,
  CHROME_USER_AGENT,
} from "./chrome-fingerprint";
import {
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import {
  transportMetadataLayer,
  transportLogAnnotations,
  type TransportName,
} from "./observability";
import {
  httpClientRequestUrl,
  httpRequestKey,
  type PreparedApiRequest,
} from "./request";

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

const toTransportError = (error: HttpClientError.HttpClientError) =>
  new TransportError({
    url: httpClientRequestUrl(error.request),
    reason: error.message,
    error,
  });

const toSortedHeaders = (
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)),
  );

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

const makeCycleTlsFetch = (
  client: CycleTLSClient,
  proxyUrl?: string,
): typeof globalThis.fetch =>
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
          ...(proxyUrl ? { proxy: proxyUrl } : {}),
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

const cycleTlsFetchLayer = (proxyUrl?: string) =>
  Layer.effect(
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
    ).pipe(Effect.map((client) => makeCycleTlsFetch(client, proxyUrl))),
  );

const makeMethodRequest = (
  method: PreparedApiRequest<unknown>["method"],
  url: string,
) => {
  switch (method) {
    case "GET":
      return HttpClientRequest.get(url);
    case "PATCH":
      return HttpClientRequest.patch(url);
    case "POST":
      return HttpClientRequest.post(url);
    case "PUT":
      return HttpClientRequest.put(url);
  }
};

export const buildHttpClientRequest = (
  request: PreparedApiRequest<unknown>,
): Effect.Effect<
  HttpClientRequest.HttpClientRequest,
  InvalidResponseError
> =>
  Effect.gen(function* () {
    let httpRequest = makeMethodRequest(request.method, request.url).pipe(
      HttpClientRequest.setHeaders(request.headers),
    );

    switch (request.body._tag) {
      case "form":
        httpRequest = HttpClientRequest.bodyUrlParams(
          httpRequest,
          request.body.value,
        );
        break;
      case "json":
        httpRequest = yield* HttpClientRequest.bodyJson(
          httpRequest,
          request.body.value,
        ).pipe(
          Effect.mapError(
            (error) =>
              new InvalidResponseError({
                endpointId: request.endpointId,
                reason: error.message,
              }),
          ),
        );
        break;
      case "none":
        break;
      case "text":
        httpRequest = HttpClientRequest.bodyText(
          httpRequest,
          request.body.value,
          request.body.contentType,
        );
        break;
    }

    return httpRequest;
  });

const decodeResponseBody = (
  request: PreparedApiRequest<unknown>,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<string | unknown, InvalidResponseError> => {
  switch (request.responseKind) {
    case "html":
    case "text":
      return response.text.pipe(
        Effect.mapError(
          (error) =>
            new InvalidResponseError({
              endpointId: request.endpointId,
              reason: error.message,
            }),
        ),
      );
    case "json":
      return response.json.pipe(
        Effect.mapError(
          (error) =>
            new InvalidResponseError({
              endpointId: request.endpointId,
              reason: error.message,
            }),
        ),
      );
  }
};

const executePrepared = (
  http: HttpClient.HttpClient,
  request: PreparedApiRequest<unknown>,
) =>
  Effect.gen(function* () {
    const httpRequest = yield* buildHttpClientRequest(request);
    const response = yield* http.execute(httpRequest).pipe(
      Effect.mapError(toTransportError),
    );

    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* new HttpStatusError({
        endpointId: request.endpointId,
        status: response.status,
        body: body.slice(0, 500),
        headers: toSortedHeaders(response.headers),
      });
    }

    const body = yield* decodeResponseBody(request, response);

    return {
      headers: toSortedHeaders(response.headers),
      cookies: response.cookies,
      body,
    } as const;
  });

export class TwitterHttpClient extends ServiceMap.Service<
  TwitterHttpClient,
  {
    readonly execute: <A>(
      request: PreparedApiRequest<A>,
    ) => Effect.Effect<
      {
        readonly headers: Readonly<Record<string, string>>;
        readonly cookies: Cookies.Cookies;
        readonly body: string | unknown;
      },
      HttpStatusError | InvalidResponseError | TransportError
    >;
  }
>()("@better-twitter-scraper/TwitterHttpClient") {
  static get fetchLayer() {
    return makeTwitterHttpClientLayer("fetch").pipe(
      Layer.provideMerge(FetchHttpClient.layer),
    );
  }

  static cycleTlsLayer(proxyUrl?: string) {
    return makeTwitterHttpClientLayer("cycleTls").pipe(
      Layer.provideMerge(
        FetchHttpClient.layer.pipe(
          Layer.provideMerge(cycleTlsFetchLayer(proxyUrl)),
        ),
      ),
    );
  }

  static scriptedLayer(script: HttpScript) {
    const rawLayer = Layer.effect(
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

            return HttpClientResponse.fromWeb(
              request,
              toWebResponse(scriptedResponse),
            );
          }),
        );
      }),
    );

    return makeTwitterHttpClientLayer("scripted").pipe(
      Layer.provideMerge(rawLayer),
    );
  }
}

function makeTwitterHttpClientLayer(transport: TransportName) {
  return Layer.mergeAll(
    transportMetadataLayer(transport),
    Layer.effect(
      TwitterHttpClient,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;

        return {
          execute: <A>(request: PreparedApiRequest<A>) =>
            executePrepared(http, request).pipe(
              Effect.annotateLogs(transportLogAnnotations(transport)),
              Effect.withSpan("TwitterHttpClient.execute"),
            ),
        };
      }),
    ),
  );
}
