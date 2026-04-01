import { Effect } from "effect";

import {
  AuthenticationError,
  BotDetectionError,
  GuestTokenError,
  HttpStatusError,
  InvalidResponseError,
  ProfileNotFoundError,
  RateLimitError,
} from "./errors";
import type { ApiRequest } from "./request";

const parseHeaderNumber = (value: string | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const classifyHttpStatusError = <A>(
  request: ApiRequest<A>,
  error: HttpStatusError,
) => {
  if (error.status === 429) {
    const limit = parseHeaderNumber(error.headers["x-rate-limit-limit"]);
    const remaining = parseHeaderNumber(
      error.headers["x-rate-limit-remaining"],
    );
    const reset = parseHeaderNumber(error.headers["x-rate-limit-reset"]);

    return new RateLimitError({
      endpointId: request.endpointId,
      bucket: request.rateLimitBucket,
      status: error.status,
      body: error.body,
      ...(limit !== undefined ? { limit } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
      ...(reset !== undefined ? { reset } : {}),
    });
  }

  if (error.status === 399) {
    return new BotDetectionError({
      endpointId: request.endpointId,
      status: error.status,
      body: error.body,
      reason: "status_399",
    });
  }

  if (
    (request.family === "graphql" || request.family === "graphqlAlt") &&
    error.status === 404 &&
    error.body.trim().length === 0
  ) {
    return new BotDetectionError({
      endpointId: request.endpointId,
      status: error.status,
      body: error.body,
      reason: "empty_404",
    });
  }

  if (error.status === 401 || error.status === 403) {
    if (request.authRequirement === "user") {
      return new AuthenticationError({
        reason: `${request.endpointId} rejected the restored authenticated session with HTTP ${error.status}.`,
      });
    }

    if (
      request.authRequirement === "guest" &&
      request.bearerToken === "default"
    ) {
      return new GuestTokenError({
        reason: `${request.endpointId} rejected the guest token with HTTP ${error.status}.`,
      });
    }
  }

  return error;
};

export const decodeParsedBody = <A>(
  request: ApiRequest<A>,
  body: string | unknown,
) =>
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
  });
