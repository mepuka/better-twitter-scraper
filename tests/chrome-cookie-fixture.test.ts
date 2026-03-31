import { describe, expect, it } from "vitest";

import {
  decodeChromeCookieValue,
  dedupeCookieRows,
  findDuplicateCookieNames,
} from "../src/chrome-cookie-fixture";

describe("chrome cookie fixture helpers", () => {
  it("strips the version-24 domain prefix before decoding the cookie value", () => {
    const prefixed = Buffer.concat([
      Buffer.alloc(32, 1),
      Buffer.from("u%3D2609036585", "utf8"),
    ]);

    expect(
      decodeChromeCookieValue({
        dbVersion: 24,
        storedValue: "",
        decryptedValue: prefixed,
      }),
    ).toBe("u%3D2609036585");
  });

  it("keeps earlier database versions unchanged", () => {
    const decrypted = Buffer.from("plain-cookie-value", "utf8");

    expect(
      decodeChromeCookieValue({
        dbVersion: 23,
        storedValue: "",
        decryptedValue: decrypted,
      }),
    ).toBe("plain-cookie-value");
  });

  it("reports duplicate cookie names before deduplicating", () => {
    const rows = [
      {
        host_key: ".x.com",
        name: "lang",
        path: "/",
        httpOnly: 0,
        secure: 0,
        encryptedHex: null,
        value: "en",
      },
      {
        host_key: "x.com",
        name: "lang",
        path: "/",
        httpOnly: 0,
        secure: 0,
        encryptedHex: null,
        value: "n",
      },
      {
        host_key: ".x.com",
        name: "ct0",
        path: "/",
        httpOnly: 0,
        secure: 1,
        encryptedHex: null,
        value: "csrf",
      },
    ] as const;

    expect(findDuplicateCookieNames(rows)).toEqual(["lang"]);
    expect(dedupeCookieRows(rows)).toHaveLength(2);
  });
});
