import { Redacted } from "effect";

import {
  CHROME_SEC_CH_UA,
  CHROME_SEC_CH_UA_MOBILE,
  CHROME_SEC_CH_UA_PLATFORM,
} from "./chrome-fingerprint";
import type { TwitterConfigShape } from "./config";
import type { ApiRequest, BearerTokenName, EndpointFamily } from "./request";

const bearerTokenValue = (
  config: TwitterConfigShape,
  bearerToken: BearerTokenName,
) =>
  Redacted.value(
    bearerToken === "secondary"
      ? config.bearerTokens.secondary
      : config.bearerTokens.default,
  );

const commonHeaders = (
  config: TwitterConfigShape,
): Readonly<Record<string, string>> => ({
  "user-agent": config.userAgent,
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": CHROME_SEC_CH_UA,
  "sec-ch-ua-mobile": CHROME_SEC_CH_UA_MOBILE,
  "sec-ch-ua-platform": CHROME_SEC_CH_UA_PLATFORM,
  referer: "https://x.com/",
  origin: "https://x.com",
  "sec-fetch-site": "same-site",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
  priority: "u=1, i",
});

const familyHeaders = (family: EndpointFamily): Readonly<Record<string, string>> => {
  switch (family) {
    case "graphql":
    case "graphqlAlt":
      return {
        accept: "application/json",
        "content-type": "application/json",
      };
    case "rest":
    case "loginFlow":
    case "activation":
      return {
        accept: "application/json",
      };
    case "pageVisit":
      return {};
  }
};

export const buildBaseHeaders = ({
  config,
  request,
  cookieHeader,
  csrfToken,
}: {
  readonly config: TwitterConfigShape;
  readonly request: ApiRequest<unknown>;
  readonly cookieHeader?: string;
  readonly csrfToken?: string;
}): Readonly<Record<string, string>> => ({
  ...commonHeaders(config),
  ...familyHeaders(request.family),
  authorization: `Bearer ${bearerTokenValue(config, request.bearerToken)}`,
  ...(cookieHeader ? { cookie: cookieHeader } : {}),
  ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
  ...(request.headers ?? {}),
});
