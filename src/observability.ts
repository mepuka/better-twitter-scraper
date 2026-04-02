import { Effect, Layer, ServiceMap } from "effect";

import type { ApiRequest } from "./request";

export type TransportName = "cycleTls" | "fetch" | "scripted";

export class TransportMetadata extends ServiceMap.Service<
  TransportMetadata,
  {
    readonly name: TransportName;
  }
>()("@better-twitter-scraper/TransportMetadata") {}

export const transportMetadataLayer = (name: TransportName) =>
  Layer.succeed(TransportMetadata, { name });

export const requestLogAnnotations = (
  request: Pick<
    ApiRequest<unknown>,
    | "authRequirement"
    | "bearerToken"
    | "endpointId"
    | "family"
    | "rateLimitBucket"
  >,
  options: {
    readonly retryAttempt: number;
    readonly transport: TransportName;
  },
) => ({
  endpoint_id: request.endpointId,
  endpoint_family: request.family,
  rate_limit_bucket: request.rateLimitBucket,
  auth_mode: request.authRequirement,
  bearer_token: request.bearerToken,
  transport: options.transport,
  retry_attempt: options.retryAttempt,
});


export const transportLogAnnotations = (transport: TransportName) => ({
  transport,
});

export const logDebugDecision = (
  message: string,
  annotations?: Readonly<Record<string, unknown>>,
) =>
  annotations
    ? Effect.annotateLogs(Effect.logDebug(message), annotations)
    : Effect.logDebug(message);
