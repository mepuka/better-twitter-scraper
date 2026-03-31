import { existsSync, readFileSync } from "node:fs";

import type { SerializedCookie } from "./cookies";

export const localCookiesFixturePath = new URL(
  "../tests/live-auth-cookies.local.json",
  import.meta.url,
);

export const parseSerializedCookies = (
  rawValue: string | undefined,
  sourceName: string,
): {
  readonly cookies?: readonly SerializedCookie[];
  readonly error?: Error;
} => {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return {
        error: new Error(
          `${sourceName} must be a JSON array of serialized cookie values.`,
        ),
      };
    }

    return { cookies: parsed as SerializedCookie[] };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error
          : new Error(`${sourceName} is not valid JSON.`),
    };
  }
};

export const loadSerializedCookies = () => {
  if (process.env.TWITTER_COOKIES) {
    return parseSerializedCookies(process.env.TWITTER_COOKIES, "TWITTER_COOKIES");
  }

  if (existsSync(localCookiesFixturePath)) {
    return parseSerializedCookies(
      readFileSync(localCookiesFixturePath, "utf8"),
      "tests/live-auth-cookies.local.json",
    );
  }

  return {};
};
