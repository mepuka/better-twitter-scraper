import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import {
  decodeChromeCookieValue,
  dedupeCookieRows,
  findDuplicateCookieNames,
  type ChromeCookieRow,
  type SerializedCookieFixture,
} from "../tests/chrome-cookie-fixture";

const fixturePath = resolve(
  dirname(import.meta.dir),
  "tests/live-auth-cookies.local.json",
);

const profilePath = process.argv.includes("--profile")
  ? resolve(
      process.argv[process.argv.indexOf("--profile") + 1] ?? "",
    )
  : join(
      process.env.HOME ?? "",
      "Library/Application Support/Google/Chrome/Default",
    );

const cookiesDbPath = join(profilePath, "Cookies");

const outputMode = process.argv.includes("--stdout") ? "stdout" : "file";

const runCommand = (
  cmd: readonly string[],
): { readonly stdout: string; readonly stderr: string; readonly exitCode: number } => {
  const result = Bun.spawnSync({
    cmd: [...cmd],
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: Buffer.from(result.stdout).toString("utf8"),
    stderr: Buffer.from(result.stderr).toString("utf8"),
    exitCode: result.exitCode,
  };
};

const runCommandOrThrow = (cmd: readonly string[]) => {
  const result = runCommand(cmd);
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}): ${result.stderr.trim() || "no stderr"}`,
    );
  }

  return result.stdout;
};

const getChromeSafeStorageKey = () => {
  const keychainLookups = [
    ["security", "find-generic-password", "-s", "Chrome Safe Storage", "-a", "Chrome", "-w"],
    ["security", "find-generic-password", "-l", "Chrome Safe Storage", "-w"],
  ] as const;

  for (const command of keychainLookups) {
    const result = runCommand(command);
    const secret = result.stdout.trim();
    if (result.exitCode === 0 && secret.length > 0) {
      return secret;
    }
  }

  throw new Error(
    "Could not read the Chrome Safe Storage key from macOS Keychain.",
  );
};

const decryptChromeCookie = (encryptedHex: string, passphrase: string) => {
  const encrypted = Buffer.from(encryptedHex, "hex");
  const version = encrypted.subarray(0, 3).toString("utf8");
  if (version !== "v10" && version !== "v11") {
    throw new Error(`Unsupported Chrome cookie version: ${version || "unknown"}`);
  }

  const key = pbkdf2Sync(passphrase, "saltysalt", 1003, 16, "sha1");
  const decipher = createDecipheriv(
    "aes-128-cbc",
    key,
    Buffer.from(" ".repeat(16), "utf8"),
  );

  return Buffer.concat([
    decipher.update(encrypted.subarray(3)),
    decipher.final(),
  ]);
};

const cookieQuery = `
select
  host_key,
  name,
  path,
  is_httponly as httpOnly,
  is_secure as secure,
  hex(encrypted_value) as encryptedHex,
  value
from cookies
where host_key in ('.x.com', 'x.com')
order by name, case when host_key = '.x.com' then 0 else 1 end
`;

const chromeCookieDbVersion = Number.parseInt(
  runCommandOrThrow([
    "sqlite3",
    "-readonly",
    cookiesDbPath,
    "select value from meta where key='version';",
  ]).trim(),
  10,
);

const rows = JSON.parse(
  runCommandOrThrow(["sqlite3", "-readonly", "-json", cookiesDbPath, cookieQuery]),
) as ChromeCookieRow[];

const passphrase = getChromeSafeStorageKey();
const duplicateCookieNames = findDuplicateCookieNames(rows);
const dedupedRows = dedupeCookieRows(rows);

if (duplicateCookieNames.length > 0) {
  console.warn(
    `Warning: multiple X cookies shared the same name and were deduplicated: ${duplicateCookieNames.join(", ")}`,
  );
}

const requiredCookies = ["ct0", "auth_token"] as const;
for (const name of requiredCookies) {
  if (!dedupedRows.some((row) => row.name === name)) {
    throw new Error(`Missing required X cookie in Chrome profile: ${name}`);
  }
}

const fixtureCookies = dedupedRows.map((row) => {
  const encryptedValue =
    row.value.length > 0
      ? undefined
      : row.encryptedHex
        ? decryptChromeCookie(row.encryptedHex, passphrase)
        : undefined;
  const value = decodeChromeCookieValue({
    dbVersion: chromeCookieDbVersion,
    storedValue: row.value,
    ...(encryptedValue === undefined ? {} : { decryptedValue: encryptedValue }),
  });

  if (!value) {
    throw new Error(`Cookie ${row.name} is present but could not be decrypted.`);
  }

  return {
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path,
    httpOnly: Boolean(row.httpOnly),
    secure: Boolean(row.secure),
  } satisfies SerializedCookieFixture;
});

const fixtureJson = `${JSON.stringify(fixtureCookies, null, 2)}\n`;

if (outputMode === "stdout") {
  process.stdout.write(fixtureJson);
} else {
  await Bun.write(fixturePath, fixtureJson);
  console.log(`Wrote ${fixtureCookies.length} cookies to ${fixturePath}`);
}
