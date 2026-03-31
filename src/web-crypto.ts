import { Data, Effect } from "effect";

export class CryptoOperationError extends Data.TaggedError(
  "CryptoOperationError",
)<{
  readonly operation: string;
  readonly reason: string;
}> {}

const textEncoder = new TextEncoder();

const toReason = (fallback: string, error: unknown) =>
  error instanceof Error ? error.message : fallback;

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
};

const fromArrayBuffer = (data: ArrayBuffer) => new Uint8Array(data);

export const utf8Bytes = (value: string) => textEncoder.encode(value);

export const hexEncode = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const tryCrypto = <A>(
  operation: string,
  fallback: string,
  tryValue: () => A,
) =>
  Effect.try({
    try: tryValue,
    catch: (error) =>
      new CryptoOperationError({
        operation,
        reason: toReason(fallback, error),
      }),
  });

const tryCryptoPromise = <A>(
  operation: string,
  fallback: string,
  tryValue: () => Promise<A>,
) =>
  Effect.tryPromise({
    try: tryValue,
    catch: (error) =>
      new CryptoOperationError({
        operation,
        reason: toReason(fallback, error),
      }),
  });

export const sha256 = (data: Uint8Array) =>
  tryCryptoPromise(
    "sha256",
    "Failed to hash the input.",
    () => globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(data)),
  ).pipe(Effect.map(fromArrayBuffer));

export const sha256Hex = (data: Uint8Array) =>
  sha256(data).pipe(Effect.map(hexEncode));

export const randomBytes = (length: number) =>
  tryCrypto(
    "randomBytes",
    "Failed to generate random bytes.",
    () => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  );

export const importAesGcmKey = (
  rawKey: Uint8Array,
  usages: ReadonlyArray<"encrypt" | "decrypt">,
) =>
  tryCryptoPromise(
    "importAesGcmKey",
    "Failed to create the AES-GCM cipher.",
    () =>
      globalThis.crypto.subtle.importKey(
        "raw",
        toArrayBuffer(rawKey),
        { name: "AES-GCM" },
        false,
        [...usages],
      ),
  );

export const encryptAesGcm = ({
  key,
  iv,
  plaintext,
}: {
  readonly key: CryptoKey;
  readonly iv: Uint8Array;
  readonly plaintext: Uint8Array;
}) =>
  tryCryptoPromise(
    "encryptAesGcm",
    "Failed to encrypt the payload.",
    () =>
      globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(iv),
        },
        key,
        toArrayBuffer(plaintext),
      ),
  ).pipe(Effect.map(fromArrayBuffer));
