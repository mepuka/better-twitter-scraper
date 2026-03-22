import { Layer, ServiceMap } from "effect";

export interface TwitterConfigShape {
  readonly bearerTokens: {
    readonly default: string;
    readonly secondary: string;
  };
  readonly guestActivateUrl: string;
  readonly browser: {
    readonly userAgent: string;
    readonly secChUa: string;
  };
  readonly guestTokenTtlMs: number;
  readonly maxTimelinePageSize: number;
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
    guestActivateUrl: "https://api.x.com/1.1/guest/activate.json",
    browser: {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      secChUa:
        "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"",
    },
    guestTokenTtlMs: 3 * 60 * 60 * 1000,
    maxTimelinePageSize: 40,
  } satisfies TwitterConfigShape);
}
