import { Effect } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import {
  encryptAesGcm,
  importAesGcmKey,
  randomBytes,
  sha256Hex,
  utf8Bytes,
} from "../src/web-crypto";

describe("web crypto helper", () => {
  it.effect("returns a stable sha256 hex digest", () =>
    Effect.gen(function* () {
      const digest = yield* sha256Hex(utf8Bytes("abc"));

      expect(digest).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    }),
  );

  it.effect("returns the requested number of random bytes", () =>
    Effect.gen(function* () {
      const bytes = yield* randomBytes(12);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(12);
    }),
  );

  it.effect("imports an aes-gcm key and encrypts plaintext", () =>
    Effect.gen(function* () {
      const key = yield* importAesGcmKey(
        new Uint8Array([
          0, 1, 2, 3, 4, 5, 6, 7,
          8, 9, 10, 11, 12, 13, 14, 15,
          16, 17, 18, 19, 20, 21, 22, 23,
          24, 25, 26, 27, 28, 29, 30, 31,
        ]),
        ["encrypt"],
      );

      const encrypted = yield* encryptAesGcm({
        key,
        iv: new Uint8Array([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]),
        plaintext: utf8Bytes("xpff-payload"),
      });

      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(encrypted.byteLength).toBeGreaterThan(12);
    }),
  );
});
