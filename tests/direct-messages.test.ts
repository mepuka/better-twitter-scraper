import { Effect, Layer, Stream } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

import {
  CookieManager,
  ScraperStrategy,
  TwitterConfig,
  TwitterDirectMessages,
  TwitterHttpClient,
  UserAuth,
} from "../index";
import { endpointRegistry } from "../src/endpoints";
import type { HttpScript } from "../src/http";
import { httpRequestKey } from "../src/request";

const restoredSessionCookies = [
  "ct0=csrf-token; Path=/; Domain=x.com",
  "auth_token=session-token; Path=/; Domain=x.com; HttpOnly",
] as const;

const dmTestLayer = (script: HttpScript) =>
  TwitterDirectMessages.layer.pipe(
    Layer.provideMerge(ScraperStrategy.standardLayer),
    Layer.provideMerge(UserAuth.testLayer()),
    Layer.provideMerge(CookieManager.testLayer()),
    Layer.provideMerge(TwitterHttpClient.scriptedLayer(script)),
    Layer.provideMerge(TwitterConfig.testLayer()),
  );

const conversationPage = (options: {
  readonly conversationId: string;
  readonly messageId: string;
  readonly minEntryId?: string;
  readonly senderId?: string;
  readonly text: string;
}) => ({
  conversation_timeline: {
    entries: [
      {
        message: {
          id: options.messageId,
          conversation_id: options.conversationId,
          time: "2026-04-06T12:00:00.000Z",
          message_data: {
            sender_id: options.senderId ?? "user-1",
            recipient_id: "user-2",
            text: options.text,
          },
        },
      },
    ],
    ...(options.minEntryId
      ? { min_entry_id: options.minEntryId }
      : {}),
  },
});

describe("TwitterDirectMessages", () => {
  it.effect("stops conversation pagination when Twitter repeats max_id", () =>
    Effect.gen(function* () {
      const auth = yield* UserAuth;
      const directMessages = yield* TwitterDirectMessages;

      yield* auth.restoreCookies(restoredSessionCookies);

      const messages = yield* Stream.runCollect(
        directMessages.getConversation("conversation-1", { limit: 10 }),
      );

      expect(messages.map((message) => message.id)).toEqual([
        "message-1",
        "message-2",
      ]);
    }).pipe(
      Effect.provide(
        dmTestLayer({
          [httpRequestKey(
            endpointRegistry.dmConversation("conversation-1"),
          )]: [{
            status: 200,
            json: conversationPage({
              conversationId: "conversation-1",
              messageId: "message-1",
              minEntryId: "dm-cursor-1",
              text: "First DM",
            }),
          }],
          [httpRequestKey(
            endpointRegistry.dmConversation("conversation-1", "dm-cursor-1"),
          )]: [{
            status: 200,
            json: conversationPage({
              conversationId: "conversation-1",
              messageId: "message-2",
              minEntryId: "dm-cursor-1",
              text: "Repeated cursor DM",
            }),
          }],
        }),
      ),
    ),
  );
});
