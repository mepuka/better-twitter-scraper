export type EndpointFamily = "graphql";
export type AuthRequirement = "guest";
export type BearerTokenName = "default" | "secondary";
export type EndpointId = "UserByScreenName" | "UserTweets" | (string & {});
export type RateLimitBucket =
  | "profileLookup"
  | "userTweets"
  | "guestActivation"
  | (string & {});

export interface ApiRequest<A> {
  readonly endpointId: EndpointId;
  readonly family: EndpointFamily;
  readonly authRequirement: AuthRequirement;
  readonly bearerToken: BearerTokenName;
  readonly rateLimitBucket: RateLimitBucket;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly decode: (body: unknown) => A;
}

export interface RawHttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface RawHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly setCookies: readonly string[];
  readonly bodyText: string;
}
