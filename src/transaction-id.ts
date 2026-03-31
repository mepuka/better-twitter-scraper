import { Effect, Layer, Option, Ref, ServiceMap } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import ClientTransaction from "x-client-transaction-id";
import { parseHTML } from "linkedom";

import type { TwitterConfigShape } from "./config";
import { TwitterConfig } from "./config";
import { HttpStatusError, InvalidResponseError, TransportError } from "./errors";
import { ensureSuccessStatus, mapHttpClientError } from "./http-client-utils";

type TransactionIdError = HttpStatusError | InvalidResponseError | TransportError;
type TransactionDocument = ReturnType<typeof parseHTML>["document"];

const DOCUMENT_CACHE_TTL_MS = 5 * 60 * 1000;

const migrationRedirectionRegex = new RegExp(
  "(http(?:s)?://(?:www\\.)?(twitter|x){1}\\.com(/x)?/migrate([/?])?tok=[a-zA-Z0-9%\\-_]+)+",
  "i",
);

const navigationHeaders = (
  requestProfile: TwitterConfigShape["requestProfile"],
): Readonly<Record<string, string>> => ({
  "user-agent": requestProfile.commonHeaders["user-agent"] ?? "",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language":
    requestProfile.commonHeaders["accept-language"] ?? "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  priority: "u=0, i",
  "sec-ch-ua": requestProfile.commonHeaders["sec-ch-ua"] ?? "",
  "sec-ch-ua-mobile": requestProfile.commonHeaders["sec-ch-ua-mobile"] ?? "?0",
  "sec-ch-ua-platform":
    requestProfile.commonHeaders["sec-ch-ua-platform"] ?? '"Windows"',
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

export class TwitterTransactionId extends ServiceMap.Service<
  TwitterTransactionId,
  {
    readonly headerFor: (
      request: Pick<HttpClientRequest.HttpClientRequest, "method" | "url">,
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
      const http = yield* HttpClient.HttpClient;
      const cacheRef = yield* Ref.make(
        Option.none<{
          readonly document: TransactionDocument;
          readonly cachedAt: number;
        }>(),
      );

      const fetchText = Effect.fn("TwitterTransactionId.fetchText")(function* (
        endpointId: string,
        request: HttpClientRequest.HttpClientRequest,
      ) {
        const response = yield* http.execute(request).pipe(
          Effect.mapError(mapHttpClientError),
        );
        const okResponse = yield* ensureSuccessStatus(endpointId, response);

        return yield* okResponse.text.pipe(
          Effect.mapError((error) =>
            transactionDocumentError(error.message),
          ),
        );
      });

      const loadDocument = Effect.fn("TwitterTransactionId.loadDocument")(function* () {
        const headers = navigationHeaders(config.requestProfile);
        const homeRequest = HttpClientRequest.get("https://x.com").pipe(
          HttpClientRequest.setHeaders(headers),
        );
        const homeHtml = yield* fetchText("TransactionIdHome", homeRequest);
        let window = parseHTML(homeHtml);
        let document = window.document;

        const metaRefresh = document.querySelector("meta[http-equiv='refresh']");
        const metaContent = metaRefresh?.getAttribute("content") ?? "";
        const migrationUrl =
          migrationRedirectionRegex.exec(metaContent)?.[0] ??
          migrationRedirectionRegex.exec(homeHtml)?.[0];

        if (migrationUrl) {
          const redirectRequest = HttpClientRequest.get(migrationUrl).pipe(
            HttpClientRequest.setHeaders(headers),
          );
          const redirectHtml = yield* fetchText(
            "TransactionIdMigrationRedirect",
            redirectRequest,
          );
          window = parseHTML(redirectHtml);
          document = window.document;
        }

        const migrationForm =
          document.querySelector("form[name='f']") ??
          document.querySelector("form[action='https://x.com/x/migrate']");

        if (migrationForm) {
          const formData = new FormData();
          for (const input of migrationForm.querySelectorAll("input")) {
            const name = input.getAttribute("name");
            const value = input.getAttribute("value");
            if (name && value) {
              formData.append(name, value);
            }
          }

          const formUrl =
            migrationForm.getAttribute("action") ?? "https://x.com/x/migrate";
          const formMethod = (
            migrationForm.getAttribute("method") ?? "POST"
          ).toUpperCase();
          const formRequest =
            formMethod === "POST"
              ? HttpClientRequest.post(formUrl).pipe(
                  HttpClientRequest.bodyFormData(formData),
                  HttpClientRequest.setHeaders(headers),
                )
              : HttpClientRequest.get(formUrl).pipe(
                  HttpClientRequest.setHeaders(headers),
                );

          const formHtml = yield* fetchText(
            "TransactionIdMigrationForm",
            formRequest,
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
        request: Pick<HttpClientRequest.HttpClientRequest, "method" | "url">,
      ) {
        const document = yield* cachedDocument();
        const url = new URL(request.url);

        const transactionId = yield* Effect.tryPromise({
          try: async () => {
            const transaction = await ClientTransaction.create(document);
            return transaction.generateTransactionId(request.method, url.pathname);
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
