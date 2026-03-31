import { Layer, ServiceMap } from "effect";

import {
  CHROME_SEC_CH_UA,
  CHROME_SEC_CH_UA_MOBILE,
  CHROME_SEC_CH_UA_PLATFORM,
  CHROME_USER_AGENT,
} from "./chrome-fingerprint";

export interface TwitterConfigShape {
  readonly bearerTokens: {
    readonly default: string;
    readonly secondary: string;
  };
  readonly urls: {
    readonly guestActivate: string;
  };
  readonly requestProfile: {
    readonly commonHeaders: Readonly<Record<string, string>>;
    readonly graphqlHeaders: Readonly<Record<string, string>>;
  };
  readonly guestTokenTtlMs: number;
  readonly timeline: {
    readonly defaultLimit: number;
    readonly maxPageSize: number;
    readonly includePromotedContent: boolean;
  };
  readonly search: {
    readonly defaultLimit: number;
    readonly maxPageSize: number;
  };
}

export class TwitterConfig extends ServiceMap.Service<
  TwitterConfig,
  TwitterConfigShape
>()("@better-twitter-scraper/TwitterConfig") {
  static readonly layer = Layer.succeed(TwitterConfig, {
    bearerTokens: {
      default:
        "AAAAAAAAAAAAAAAAAAAAAFQODgEAAAAAVHTp76lzh3rFzcHbmHVvQxYYpTw%3DckAlMINMjmCwxUcaXbAN4XqJVdgMJaHqNOFgPMK0zN1qLqLQCF",
      secondary:
        "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    },
    urls: {
      guestActivate: "https://api.x.com/1.1/guest/activate.json",
    },
    requestProfile: {
      commonHeaders: {
        "user-agent": CHROME_USER_AGENT,
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
      },
      graphqlHeaders: {
        accept: "application/json",
        "content-type": "application/json",
      },
    },
    guestTokenTtlMs: 3 * 60 * 60 * 1000,
    timeline: {
      defaultLimit: 20,
      maxPageSize: 40,
      includePromotedContent: false,
    },
    search: {
      defaultLimit: 20,
      maxPageSize: 50,
    },
  } satisfies TwitterConfigShape);
}
