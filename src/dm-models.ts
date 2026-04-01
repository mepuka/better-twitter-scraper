import { Schema } from "effect";

export class DmMessage extends Schema.Class<DmMessage>("DmMessage")({
  id: Schema.String,
  conversationId: Schema.String,
  senderId: Schema.String,
  recipientId: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  createdAt: Schema.optionalKey(Schema.String),
  mediaUrls: Schema.Array(Schema.String),
}) {}

export class DmConversation extends Schema.Class<DmConversation>("DmConversation")({
  conversationId: Schema.String,
  messages: Schema.Array(DmMessage),
  participants: Schema.Array(
    Schema.Struct({
      userId: Schema.String,
      screenName: Schema.optionalKey(Schema.String),
    }),
  ),
  status: Schema.optionalKey(Schema.String),
  minEntryId: Schema.optionalKey(Schema.String),
  maxEntryId: Schema.optionalKey(Schema.String),
}) {}

export class DmInbox extends Schema.Class<DmInbox>("DmInbox")({
  conversations: Schema.Array(DmConversation),
  cursor: Schema.optionalKey(Schema.String),
}) {}

/**
 * Represents a single page of conversation messages returned by the
 * conversation endpoint. Used internally for pagination.
 */
export class DmConversationPage extends Schema.Class<DmConversationPage>("DmConversationPage")({
  conversationId: Schema.String,
  messages: Schema.Array(DmMessage),
  status: Schema.optionalKey(Schema.String),
  minEntryId: Schema.optionalKey(Schema.String),
  maxEntryId: Schema.optionalKey(Schema.String),
}) {}
