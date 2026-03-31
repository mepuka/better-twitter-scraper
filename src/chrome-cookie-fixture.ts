export interface ChromeCookieRow {
  readonly host_key: string;
  readonly name: string;
  readonly path: string;
  readonly httpOnly: number;
  readonly secure: number;
  readonly encryptedHex: string | null;
  readonly value: string;
}

export interface SerializedCookieFixture {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly httpOnly: boolean;
  readonly secure: boolean;
}

export const decodeChromeCookieValue = (options: {
  readonly dbVersion: number;
  readonly storedValue: string;
  readonly decryptedValue?: Buffer;
}) => {
  if (options.storedValue.length > 0) {
    return options.storedValue;
  }

  const decodedBuffer =
    options.decryptedValue && options.dbVersion >= 24
      ? options.decryptedValue.subarray(32)
      : options.decryptedValue;

  return decodedBuffer?.toString("utf8");
};

export const dedupeCookieRows = (rows: readonly ChromeCookieRow[]) => {
  const cookiesByName = new Map<string, ChromeCookieRow>();

  for (const row of rows) {
    if (!cookiesByName.has(row.name)) {
      cookiesByName.set(row.name, row);
    }
  }

  return [...cookiesByName.values()];
};

export const findDuplicateCookieNames = (rows: readonly ChromeCookieRow[]) => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
};
