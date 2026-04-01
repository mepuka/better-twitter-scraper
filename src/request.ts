import { Option } from "effect";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

export type EndpointFamily =
  | "graphql"
  | "graphqlAlt"
  | "rest"
  | "loginFlow"
  | "activation"
  | "pageVisit";
export type AuthRequirement = "guest" | "user";
export type BearerTokenName = "default" | "secondary";
export type RequestMethod = "GET" | "PATCH" | "POST" | "PUT";
export type ResponseKind = "html" | "json" | "text";
export type EndpointId =
  | "GuestActivate"
  | "Followers"
  | "Following"
  | "SearchProfiles"
  | "TweetDetail"
  | "UserByScreenName"
  | "UserTweets"
  | (string & {});
export type RateLimitBucket =
  | "followers"
  | "generic"
  | "guestActivation"
  | "following"
  | "profileLookup"
  | "searchProfiles"
  | "tweetDetail"
  | "userTweets"
  | (string & {});

export type ApiRequestBody =
  | {
      readonly _tag: "form";
      readonly value: Readonly<Record<string, string>>;
    }
  | {
      readonly _tag: "json";
      readonly value: unknown;
    }
  | {
      readonly _tag: "none";
    }
  | {
      readonly _tag: "text";
      readonly contentType?: string;
      readonly value: string;
    };

export interface ApiRequest<A> {
  readonly endpointId: EndpointId;
  readonly family: EndpointFamily;
  readonly authRequirement: AuthRequirement;
  readonly bearerToken: BearerTokenName;
  readonly rateLimitBucket: RateLimitBucket;
  readonly method: RequestMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: ApiRequestBody;
  readonly responseKind: ResponseKind;
  readonly decode: (body: string | unknown) => A;
}

export interface PreparedApiRequest<A> extends Omit<ApiRequest<A>, "headers"> {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ApiRequestBody;
}

const noneBody = {
  _tag: "none",
} as const satisfies ApiRequestBody;

export const prepareApiRequest = <A>(
  request: ApiRequest<A>,
  headers: Readonly<Record<string, string>>,
): PreparedApiRequest<A> => ({
  ...request,
  headers,
  body: request.body ?? noneBody,
});

export const httpClientRequestUrl = (
  request: HttpClientRequest.HttpClientRequest,
) =>
  Option.match(HttpClientRequest.toUrl(request), {
    onNone: () => request.url,
    onSome: (url) => url.toString(),
  });

type RequestLike =
  | ApiRequest<unknown>
  | PreparedApiRequest<unknown>
  | HttpClientRequest.HttpClientRequest
  | Pick<HttpClientRequest.HttpClientRequest, "method" | "url">;

const requestLikeUrl = (request: RequestLike) =>
  "urlParams" in request ? httpClientRequestUrl(request) : request.url;

export const httpRequestKey = (request: RequestLike) =>
  `${request.method.toUpperCase()} ${requestLikeUrl(request)}`;
