import { Effect } from "effect";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  HttpStatusError,
  InvalidResponseError,
  ProfileNotFoundError,
  TransportError,
} from "./errors";
import { httpClientRequestUrl, type ApiRequest } from "./request";

export const mapHttpClientError = (error: HttpClientError.HttpClientError) =>
  new TransportError({
    url: httpClientRequestUrl(error.request),
    reason: error.message,
    error,
  });

export const ensureSuccessStatus = (
  endpointId: string,
  response: HttpClientResponse.HttpClientResponse,
) =>
  HttpClientResponse.matchStatus(response, {
    "2xx": () => Effect.succeed(response),
    orElse: (badResponse) =>
      badResponse.text.pipe(
        Effect.orElseSucceed(() => ""),
        Effect.flatMap((body) =>
          Effect.fail(
            new HttpStatusError({
              endpointId,
              status: badResponse.status,
              body: body.slice(0, 500),
            }),
          ),
        ),
      ),
  });

export const decodeJsonResponse = <A>(
  request: ApiRequest<A>,
  response: HttpClientResponse.HttpClientResponse,
) =>
  response.json.pipe(
    Effect.mapError(
      (error) =>
        new InvalidResponseError({
          endpointId: request.endpointId,
          reason: error.message,
        }),
    ),
    Effect.flatMap((body) =>
      Effect.try({
        try: () => request.decode(body),
        catch: (error) => {
          if (error instanceof ProfileNotFoundError) {
            return error;
          }

          if (error instanceof InvalidResponseError) {
            return error;
          }

          return new InvalidResponseError({
            endpointId: request.endpointId,
            reason:
              error instanceof Error
                ? error.message
                : "Failed to decode Twitter response",
          });
        },
      }),
    ),
  );
