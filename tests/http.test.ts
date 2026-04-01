import { Effect } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import { TwitterHttpClient } from "../index";
import { buildHttpClientRequest } from "../src/http";
import { prepareApiRequest, type ApiRequest } from "../src/request";

const makePreparedRequest = <A>(
  request: ApiRequest<A>,
  headers: Readonly<Record<string, string>> = {},
) => prepareApiRequest(request, headers);

describe("TwitterHttpClient transport", () => {
  it.effect("parses a GraphQL JSON response through the transport layer", () =>
    Effect.gen(function* () {
      const request = makePreparedRequest({
        endpointId: "TransportJson",
        family: "graphql",
        authRequirement: "guest",
        bearerToken: "secondary",
        rateLimitBucket: "generic",
        method: "GET",
        url: "https://api.x.com/graphql/test/TransportJson",
        responseKind: "json",
        decode: (body) => body,
      });

      const http = yield* TwitterHttpClient;
      const response = yield* http.execute(request);

      expect(response.body).toEqual({ ok: true });
    }).pipe(
      Effect.provide(
        TwitterHttpClient.scriptedLayer({
          "GET https://api.x.com/graphql/test/TransportJson": [
            {
              status: 200,
              json: { ok: true },
            },
          ],
        }),
      ),
    ),
  );

  it.effect("parses an activation JSON response through the transport layer", () =>
    Effect.gen(function* () {
      const request = makePreparedRequest({
        endpointId: "GuestActivate",
        family: "activation",
        authRequirement: "guest",
        bearerToken: "default",
        rateLimitBucket: "guestActivation",
        method: "POST",
        url: "https://api.x.com/1.1/guest/activate.json",
        body: {
          _tag: "form",
          value: {},
        },
        responseKind: "json",
        decode: (body) => body,
      });

      const http = yield* TwitterHttpClient;
      const response = yield* http.execute(request);

      expect(response.body).toEqual({ guest_token: "guest-1" });
    }).pipe(
      Effect.provide(
        TwitterHttpClient.scriptedLayer({
          "POST https://api.x.com/1.1/guest/activate.json": [
            {
              status: 200,
              json: { guest_token: "guest-1" },
            },
          ],
        }),
      ),
    ),
  );

  it.effect("builds URL-encoded form bodies for form requests", () =>
    Effect.gen(function* () {
      const request = yield* buildHttpClientRequest(
        makePreparedRequest(
          {
            endpointId: "FormRequest",
            family: "activation",
            authRequirement: "guest",
            bearerToken: "default",
            rateLimitBucket: "generic",
            method: "POST",
            url: "https://api.x.com/form",
            body: {
              _tag: "form",
              value: {
                a: "1",
                b: "two",
              },
            },
            responseKind: "json",
            decode: (body) => body,
          },
          {
            "x-test": "yes",
          },
        ),
      );

      expect(request.headers["content-type"]).toContain(
        "application/x-www-form-urlencoded",
      );
      expect(request.body.toJSON()).toMatchObject({
        _tag: "Uint8Array",
      });
    }),
  );

  it.effect("builds text bodies for text requests", () =>
    Effect.gen(function* () {
      const request = yield* buildHttpClientRequest(
        makePreparedRequest(
          {
            endpointId: "TextRequest",
            family: "rest",
            authRequirement: "user",
            bearerToken: "secondary",
            rateLimitBucket: "generic",
            method: "POST",
            url: "https://api.x.com/text",
            body: {
              _tag: "text",
              value: "hello world",
              contentType: "text/plain",
            },
            responseKind: "text",
            decode: (body) => body,
          },
          {
            "x-test": "yes",
          },
        ),
      );

      expect(request.headers["content-type"]).toBe("text/plain");
      expect(request.body.toJSON()).toMatchObject({
        _tag: "Uint8Array",
      });
    }),
  );
});
