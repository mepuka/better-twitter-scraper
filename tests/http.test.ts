import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { TwitterHttpClient } from "../index";
import { buildHttpClientRequest } from "../src/http";
import { prepareApiRequest, type ApiRequest } from "../src/request";

const makePreparedRequest = <A>(
  request: ApiRequest<A>,
  headers: Readonly<Record<string, string>> = {},
) => prepareApiRequest(request, headers);

describe("TwitterHttpClient transport", () => {
  it("parses a GraphQL JSON response through the transport layer", async () => {
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

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* TwitterHttpClient;
        return yield* http.execute(request);
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

    expect(response.body).toEqual({ ok: true });
  });

  it("parses an activation JSON response through the transport layer", async () => {
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

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* TwitterHttpClient;
        return yield* http.execute(request);
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

    expect(response.body).toEqual({ guest_token: "guest-1" });
  });

  it("builds URL-encoded form bodies for form requests", async () => {
    const request = await Effect.runPromise(
      buildHttpClientRequest(
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
      ),
    );

    expect(request.headers["content-type"]).toContain(
      "application/x-www-form-urlencoded",
    );
    expect(request.body.toJSON()).toMatchObject({
      _tag: "Uint8Array",
    });
  });

  it("builds text bodies for text requests", async () => {
    const request = await Effect.runPromise(
      buildHttpClientRequest(
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
      ),
    );

    expect(request.headers["content-type"]).toBe("text/plain");
    expect(request.body.toJSON()).toMatchObject({
      _tag: "Uint8Array",
    });
  });
});
