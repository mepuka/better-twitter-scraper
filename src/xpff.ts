import { Effect, Layer, ServiceMap } from "effect";

import { CHROME_USER_AGENT } from "./chrome-fingerprint";
import { CookieManager } from "./cookies";
import { InvalidResponseError } from "./errors";
import {
  encryptAesGcm,
  hexEncode,
  importAesGcmKey,
  randomBytes,
  sha256,
  utf8Bytes,
} from "./web-crypto";

const XPFF_BASE_KEY =
  "0e6be1f1e21ffc33590b888fd4dc81b19713e570e805d4e5df80a493c9571a05";

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
    const key = yield* sha256(utf8Bytes(`${XPFF_BASE_KEY}${guestId}`));
    const nonce = yield* randomBytes(12);
    const cipher = yield* importAesGcmKey(key, ["encrypt"]);
    const encrypted = yield* encryptAesGcm({
      key: cipher,
      iv: nonce,
      plaintext: utf8Bytes(xpffPlaintext()),
    });

    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce);
    combined.set(encrypted, nonce.length);

    return hexEncode(combined);
  }).pipe(
    Effect.mapError(
      (error) =>
        new InvalidResponseError({
          endpointId: "XpffHeader",
          reason: error.reason,
        }),
    ),
  );

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

      const headerFor = Effect.fn("TwitterXpff.headerFor")(() =>
        Effect.gen(function* () {
          const guestId = yield* cookies.get("guest_id");

          if (!guestId) {
            return {};
          }

          const header = yield* generateXpffHeader(guestId);
          return {
            "x-xp-forwarded-for": header,
          } as const;
        }).pipe(Effect.withSpan("TwitterXpff.headerFor")),
      );

      return { headerFor };
    }),
  );
}
