import { Effect, Layer, ServiceMap } from "effect";

import { CHROME_USER_AGENT } from "./chrome-fingerprint";
import { CookieManager } from "./cookies";
import { InvalidResponseError } from "./errors";

const XPFF_BASE_KEY =
  "0e6be1f1e21ffc33590b888fd4dc81b19713e570e805d4e5df80a493c9571a05";

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = (message: string) =>
  Effect.tryPromise({
    try: async () => {
      const encoded = new TextEncoder().encode(message);
      const digest = await crypto.subtle.digest("SHA-256", encoded);
      return new Uint8Array(digest);
    },
    catch: (error) =>
      new InvalidResponseError({
        endpointId: "XpffHeader",
        reason:
          error instanceof Error
            ? error.message
            : "Failed to derive the XPFF encryption key.",
      }),
  });

const xpffPlaintext = () =>
  JSON.stringify({
    navigator_properties: {
      hasBeenActive: "true",
      userAgent: CHROME_USER_AGENT,
      webdriver: "false",
    },
    created_at: Date.now(),
  });

const generateXpffHeader = (guestId: string) =>
  Effect.gen(function* () {
    const key = yield* sha256(`${XPFF_BASE_KEY}${guestId}`);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const cipher = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
          "encrypt",
        ]),
      catch: (error) =>
        new InvalidResponseError({
          endpointId: "XpffHeader",
          reason:
            error instanceof Error
              ? error.message
              : "Failed to create the XPFF cipher.",
        }),
    });
    const encrypted = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: nonce,
          },
          cipher,
          new TextEncoder().encode(xpffPlaintext()),
        ),
      catch: (error) =>
        new InvalidResponseError({
          endpointId: "XpffHeader",
          reason:
            error instanceof Error
              ? error.message
              : "Failed to encrypt the XPFF payload.",
        }),
    });

    const combined = new Uint8Array(nonce.length + encrypted.byteLength);
    combined.set(nonce);
    combined.set(new Uint8Array(encrypted), nonce.length);

    return toHex(combined);
  });

export class TwitterXpff extends ServiceMap.Service<
  TwitterXpff,
  {
    readonly headerFor: () => Effect.Effect<
      Readonly<Record<string, string>>,
      InvalidResponseError
    >;
  }
>()("@better-twitter-scraper/TwitterXpff") {
  static readonly disabledLayer = Layer.succeed(TwitterXpff, {
    headerFor: () => Effect.succeed({}),
  });

  static testLayer(value = "test-xpff") {
    return Layer.succeed(TwitterXpff, {
      headerFor: () =>
        Effect.succeed({
          "x-xp-forwarded-for": value,
        }),
    });
  }

  static readonly liveLayer = Layer.effect(
    TwitterXpff,
    Effect.gen(function* () {
      const cookies = yield* CookieManager;

      const headerFor = Effect.fn("TwitterXpff.headerFor")(function* () {
        const guestId = yield* cookies.get("guest_id");

        if (!guestId) {
          return {};
        }

        const header = yield* generateXpffHeader(guestId);
        return {
          "x-xp-forwarded-for": header,
        } as const;
      });

      return { headerFor };
    }),
  );
}
