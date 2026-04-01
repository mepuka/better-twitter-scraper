import { Data } from "effect";

import type { RateLimitBucket } from "./request";

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly url: string;
  readonly reason: string;
  readonly error: unknown;
}> {}

export class GuestTokenError extends Data.TaggedError("GuestTokenError")<{
  readonly reason: string;
}> {}

export class HttpStatusError extends Data.TaggedError("HttpStatusError")<{
  readonly endpointId: string;
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}> {}

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly endpointId: string;
  readonly bucket: RateLimitBucket;
  readonly status: number;
  readonly body: string;
  readonly limit?: number;
  readonly remaining?: number;
  readonly reset?: number;
}> {}

export class BotDetectionError extends Data.TaggedError("BotDetectionError")<{
  readonly endpointId: string;
  readonly status: number;
  readonly body: string;
  readonly reason: "status_399" | "empty_404" | (string & {});
}> {}

export class InvalidResponseError extends Data.TaggedError(
  "InvalidResponseError",
)<{
  readonly endpointId: string;
  readonly reason: string;
}> {}

export class ProfileNotFoundError extends Data.TaggedError(
  "ProfileNotFoundError",
)<{
  readonly username: string;
}> {}

export class TweetNotFoundError extends Data.TaggedError(
  "TweetNotFoundError",
)<{
  readonly id: string;
}> {}

export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError",
)<{
  readonly reason: string;
}> {}
