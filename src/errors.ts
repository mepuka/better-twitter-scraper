import { Data } from "effect";

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

export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError",
)<{
  readonly reason: string;
}> {}
