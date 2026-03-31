import { Effect, Layer, Option, Ref, ServiceMap } from "effect";

import ClientTransaction from "x-client-transaction-id";
import { parseHTML } from "linkedom";

import {
  CHROME_SEC_CH_UA,
  CHROME_SEC_CH_UA_MOBILE,
  CHROME_SEC_CH_UA_PLATFORM,
} from "./chrome-fingerprint";
import { TwitterConfig } from "./config";
import {
  HttpStatusError,
  InvalidResponseError,
  TransportError,
} from "./errors";
import { TwitterHttpClient } from "./http";
import type { PreparedApiRequest } from "./request";

type TransactionIdError =
  | HttpStatusError
  | InvalidResponseError
  | TransportError;
type TransactionDocument = ReturnType<typeof parseHTML>["document"];

const DOCUMENT_CACHE_TTL_MS = 5 * 60 * 1000;

const migrationRedirectionRegex = new RegExp(
  "(http(?:s)?://(?:www\\.)?(twitter|x){1}\\.com(/x)?/migrate([/?])?tok=[a-zA-Z0-9%\\-_]+)+",
  "i",
);

const navigationHeaders = (userAgent: string): Readonly<Record<string, string>> => ({
  "user-agent": userAgent,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  priority: "u=0, i",
  "sec-ch-ua": CHROME_SEC_CH_UA,
  "sec-ch-ua-mobile": CHROME_SEC_CH_UA_MOBILE,
  "sec-ch-ua-platform": CHROME_SEC_CH_UA_PLATFORM,
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
});

const transactionDocumentError = (reason: string) =>
  new InvalidResponseError({
    endpointId: "TransactionIdDocument",
    reason,
  });

const pageVisitRequest = ({
  endpointId,
  headers,
  method,
  url,
  body,
}: {
  readonly endpointId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: PreparedApiRequest<string>["body"];
}): PreparedApiRequest<string> => ({
  endpointId,
  family: "pageVisit",
  authRequirement: "guest",
  bearerToken: "secondary",
  rateLimitBucket: "generic",
  method,
  url,
  headers,
  body: body ?? { _tag: "none" },
  responseKind: "html",
  decode: (value) => {
    if (typeof value !== "string") {
      throw transactionDocumentError("Expected an HTML document string.");
    }

    return value;
  },
});

export class TwitterTransactionId extends ServiceMap.Service<
  TwitterTransactionId,
  {
    readonly headerFor: (
      request: {
        readonly method: string;
        readonly url: string;
      },
    ) => Effect.Effect<Readonly<Record<string, string>>, TransactionIdError>;
  }
>()("@better-twitter-scraper/TwitterTransactionId") {
  static readonly disabledLayer = Layer.succeed(TwitterTransactionId, {
    headerFor: () => Effect.succeed({}),
  });

  static testLayer(transactionId = "test-transaction-id") {
    return Layer.succeed(TwitterTransactionId, {
      headerFor: () =>
        Effect.succeed({
          "x-client-transaction-id": transactionId,
        }),
    });
  }

  static readonly liveLayer = Layer.effect(
    TwitterTransactionId,
    Effect.gen(function* () {
      const config = yield* TwitterConfig;
      const http = yield* TwitterHttpClient;
      const cacheRef = yield* Ref.make(
        Option.none<{
          readonly document: TransactionDocument;
          readonly cachedAt: number;
        }>(),
      );

      const fetchText = Effect.fn("TwitterTransactionId.fetchText")(function* (
        request: PreparedApiRequest<string>,
      ) {
        const response = yield* http.execute(request);
        if (typeof response.body !== "string") {
          return yield* transactionDocumentError("Expected an HTML document string.");
        }
        return response.body;
      });

      const loadDocument = Effect.fn("TwitterTransactionId.loadDocument")(function* () {
        const headers = navigationHeaders(config.userAgent);
        const homeHtml = yield* fetchText(
          pageVisitRequest({
            endpointId: "TransactionIdHome",
            headers,
            method: "GET",
            url: "https://x.com",
          }),
        );

        let window = parseHTML(homeHtml);
        let document = window.document;

        const metaRefresh = document.querySelector("meta[http-equiv='refresh']");
        const metaContent = metaRefresh?.getAttribute("content") ?? "";
        const migrationUrl =
          migrationRedirectionRegex.exec(metaContent)?.[0] ??
          migrationRedirectionRegex.exec(homeHtml)?.[0];

        if (migrationUrl) {
          const redirectHtml = yield* fetchText(
            pageVisitRequest({
              endpointId: "TransactionIdMigrationRedirect",
              headers,
              method: "GET",
              url: migrationUrl,
            }),
          );
          window = parseHTML(redirectHtml);
          document = window.document;
        }

        const migrationForm =
          document.querySelector("form[name='f']") ??
          document.querySelector("form[action='https://x.com/x/migrate']");

        if (migrationForm) {
          const formEntries: Record<string, string> = {};
          for (const input of migrationForm.querySelectorAll("input")) {
            const name = input.getAttribute("name");
            const value = input.getAttribute("value");
            if (name && value) {
              formEntries[name] = value;
            }
          }

          const formUrl =
            migrationForm.getAttribute("action") ?? "https://x.com/x/migrate";
          const formMethod = (
            migrationForm.getAttribute("method") ?? "POST"
          ).toUpperCase() as "GET" | "POST";
          const formHtml = yield* fetchText(
            pageVisitRequest({
              endpointId: "TransactionIdMigrationForm",
              headers,
              method: formMethod,
              url: formUrl,
              ...(formMethod === "POST"
                ? {
                    body: {
                      _tag: "form" as const,
                      value: formEntries,
                    },
                  }
                : {}),
            }),
          );
          window = parseHTML(formHtml);
          document = window.document;
        }

        return document;
      });

      const cachedDocument = Effect.fn("TwitterTransactionId.cachedDocument")(function* () {
        const existing = yield* Ref.get(cacheRef);
        const now = Date.now();

        if (
          Option.isSome(existing) &&
          now - existing.value.cachedAt < DOCUMENT_CACHE_TTL_MS
        ) {
          return existing.value.document;
        }

        const document = yield* loadDocument();
        yield* Ref.set(
          cacheRef,
          Option.some({
            document,
            cachedAt: now,
          }),
        );
        return document;
      });

      const headerFor = Effect.fn("TwitterTransactionId.headerFor")(function* (
        request: {
          readonly method: string;
          readonly url: string;
        },
      ) {
        const document = yield* cachedDocument();
        const url = new URL(request.url);

        const transactionId = yield* Effect.tryPromise({
          try: async () => {
            const transaction = await ClientTransaction.create(document);
            return transaction.generateTransactionId(
              request.method.toUpperCase(),
              url.pathname,
            );
          },
          catch: (error) =>
            transactionDocumentError(
              error instanceof Error
                ? error.message
                : "Failed to generate X transaction ID.",
            ),
        });

        return {
          "x-client-transaction-id": transactionId,
        } as const;
      });

      return { headerFor };
    }),
  );
}
