import { Schema } from "effect";

export class TransportError extends Schema.TaggedErrorClass<TransportError>()(
  "TransportError",
  {
    url: Schema.String,
    reason: Schema.String,
    error: Schema.Defect,
  },
) {}

export class GuestTokenError extends Schema.TaggedErrorClass<GuestTokenError>()(
  "GuestTokenError",
  {
    reason: Schema.String,
  },
) {}

export class HttpStatusError extends Schema.TaggedErrorClass<HttpStatusError>()(
  "HttpStatusError",
  {
    endpointId: Schema.String,
    status: Schema.Number,
    body: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  },
) {}

export class RateLimitError extends Schema.TaggedErrorClass<RateLimitError>()(
  "RateLimitError",
  {
    endpointId: Schema.String,
    bucket: Schema.String,
    status: Schema.Number,
    body: Schema.String,
    limit: Schema.optionalKey(Schema.Number),
    remaining: Schema.optionalKey(Schema.Number),
    reset: Schema.optionalKey(Schema.Number),
  },
) {}

export class BotDetectionError extends Schema.TaggedErrorClass<BotDetectionError>()(
  "BotDetectionError",
  {
    endpointId: Schema.String,
    status: Schema.Number,
    body: Schema.String,
    reason: Schema.String,
  },
) {}

export class InvalidResponseError extends Schema.TaggedErrorClass<InvalidResponseError>()(
  "InvalidResponseError",
  {
    endpointId: Schema.String,
    reason: Schema.String,
  },
) {}

export class ProfileNotFoundError extends Schema.TaggedErrorClass<ProfileNotFoundError>()(
  "ProfileNotFoundError",
  {
    username: Schema.String,
  },
) {}

export class TweetNotFoundError extends Schema.TaggedErrorClass<TweetNotFoundError>()(
  "TweetNotFoundError",
  {
    id: Schema.String,
  },
) {}

export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()(
  "AuthenticationError",
  {
    reason: Schema.String,
  },
) {}
