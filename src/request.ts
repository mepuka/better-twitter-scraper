import { Option } from "effect";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

export type EndpointFamily = "graphql";
export type AuthRequirement = "guest" | "user";
export type BearerTokenName = "default" | "secondary";
export type EndpointId =
  | "UserByScreenName"
  | "UserTweets"
  | "SearchProfiles"
  | (string & {});
export type RateLimitBucket =
  | "profileLookup"
  | "userTweets"
  | "searchProfiles"
  | "guestActivation"
  | (string & {});

export interface ApiRequest<A> {
  readonly endpointId: EndpointId;
  readonly family: EndpointFamily;
  readonly authRequirement: AuthRequirement;
  readonly bearerToken: BearerTokenName;
  readonly rateLimitBucket: RateLimitBucket;
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly decode: (body: unknown) => A;
}

export const httpClientRequestUrl = (
  request: HttpClientRequest.HttpClientRequest,
) =>
  Option.match(HttpClientRequest.toUrl(request), {
    onNone: () => request.url,
    onSome: (url) => url.toString(),
  });
