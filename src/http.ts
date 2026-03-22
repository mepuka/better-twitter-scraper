import { Effect, Layer, Ref } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { httpClientRequestUrl } from "./request";

export interface ScriptedHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly setCookies?: readonly string[];
  readonly bodyText?: string;
  readonly json?: unknown;
}

export type HttpScript = Readonly<Record<string, readonly ScriptedHttpResponse[]>>;

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

export class TwitterHttpClient {
  static readonly liveLayer = FetchHttpClient.layer;

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
