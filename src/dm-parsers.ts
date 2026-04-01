import { InvalidResponseError } from "./errors";
import {
  DmConversation,
  DmConversationPage,
  DmInbox,
  DmMessage,
} from "./dm-models";

// ---------------------------------------------------------------------------
// Raw API response shapes
// ---------------------------------------------------------------------------

interface DmMessageDataRaw {
  readonly id?: string;
  readonly time?: string;
  readonly recipient_id?: string;
  readonly sender_id?: string;
  readonly text?: string;
  readonly attachment?: {
    readonly photo?: { readonly media_url_https?: string };
    readonly video?: { readonly media_url_https?: string };
    readonly animated_gif?: { readonly media_url_https?: string };
  };
  readonly entities?: {
    readonly urls?: ReadonlyArray<{
      readonly expanded_url?: string;
    }>;
  };
}

interface DmMessageRaw {
  readonly id?: string;
  readonly time?: string;
  readonly conversation_id?: string;
  readonly message_data?: DmMessageDataRaw;
}

interface DmMessageEntryRaw {
  readonly message?: DmMessageRaw;
}

interface DmParticipantRaw {
  readonly user_id?: string;
}

interface DmConversationRaw {
  readonly conversation_id?: string;
  readonly participants?: ReadonlyArray<DmParticipantRaw>;
  readonly status?: string;
  readonly min_entry_id?: string;
  readonly max_entry_id?: string;
}

interface DmUserRaw {
  readonly id_str?: string;
  readonly screen_name?: string;
}

interface DmInboxResponseRaw {
  readonly inbox_initial_state?: {
    readonly conversations?: Readonly<Record<string, DmConversationRaw>>;
    readonly entries?: ReadonlyArray<DmMessageEntryRaw>;
    readonly users?: Readonly<Record<string, DmUserRaw>>;
    readonly cursor?: string;
  };
}

interface DmConversationResponseRaw {
  readonly conversation_timeline?: {
    readonly entries?: ReadonlyArray<DmMessageEntryRaw>;
    readonly min_entry_id?: string;
    readonly max_entry_id?: string;
    readonly status?: string;
    readonly conversations?: Readonly<Record<string, DmConversationRaw>>;
    readonly users?: Readonly<Record<string, DmUserRaw>>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseMessageEntry = (
  entry: DmMessageEntryRaw,
): DmMessage | undefined => {
  const msg = entry.message;
  if (!msg) return undefined;

  const data = msg.message_data;
  if (!data) return undefined;

  const id = msg.id ?? data.id;
  const senderId = data.sender_id;
  const conversationId = msg.conversation_id;

  if (!id || !senderId || !conversationId) return undefined;

  const mediaUrls: string[] = [];
  if (data.attachment?.photo?.media_url_https) {
    mediaUrls.push(data.attachment.photo.media_url_https);
  }
  if (data.attachment?.video?.media_url_https) {
    mediaUrls.push(data.attachment.video.media_url_https);
  }
  if (data.attachment?.animated_gif?.media_url_https) {
    mediaUrls.push(data.attachment.animated_gif.media_url_https);
  }

  return new DmMessage({
    id,
    conversationId,
    senderId,
    ...(data.recipient_id ? { recipientId: data.recipient_id } : {}),
    ...(data.text ? { text: data.text } : {}),
    ...(msg.time ?? data.time ? { createdAt: (msg.time ?? data.time)! } : {}),
    mediaUrls,
  });
};

const buildParticipants = (
  conv: DmConversationRaw,
  users: Readonly<Record<string, DmUserRaw>> | undefined,
): Array<{ userId: string; screenName?: string }> =>
  (conv.participants ?? []).flatMap((p) => {
    if (!p.user_id) return [];
    const user = users?.[p.user_id];
    return [
      {
        userId: p.user_id,
        ...(user?.screen_name ? { screenName: user.screen_name } : {}),
      },
    ];
  });

// ---------------------------------------------------------------------------
// Public parsers
// ---------------------------------------------------------------------------

export const parseDmInboxResponse = (body: unknown): DmInbox => {
  const raw = body as DmInboxResponseRaw;
  const state = raw.inbox_initial_state;

  if (!state) {
    throw new InvalidResponseError({
      endpointId: "DmInbox",
      reason: "Missing inbox_initial_state in DM inbox response",
    });
  }

  const users = state.users;

  // Group messages by conversation
  const messagesByConv = new Map<string, DmMessage[]>();
  for (const entry of state.entries ?? []) {
    const msg = parseMessageEntry(entry);
    if (!msg) continue;
    const list = messagesByConv.get(msg.conversationId) ?? [];
    list.push(msg);
    messagesByConv.set(msg.conversationId, list);
  }

  const conversations: DmConversation[] = [];
  for (const [convId, convRaw] of Object.entries(state.conversations ?? {})) {
    conversations.push(
      new DmConversation({
        conversationId: convRaw.conversation_id ?? convId,
        messages: messagesByConv.get(convRaw.conversation_id ?? convId) ?? [],
        participants: buildParticipants(convRaw, users),
        ...(convRaw.status ? { status: convRaw.status } : {}),
        ...(convRaw.min_entry_id
          ? { minEntryId: convRaw.min_entry_id }
          : {}),
        ...(convRaw.max_entry_id
          ? { maxEntryId: convRaw.max_entry_id }
          : {}),
      }),
    );
  }

  return new DmInbox({
    conversations,
    ...(state.cursor ? { cursor: state.cursor } : {}),
  });
};

export const parseDmConversationResponse = (
  body: unknown,
  conversationId: string,
): DmConversationPage => {
  const raw = body as DmConversationResponseRaw;
  const timeline = raw.conversation_timeline;

  if (!timeline) {
    throw new InvalidResponseError({
      endpointId: "DmConversation",
      reason: "Missing conversation_timeline in DM conversation response",
    });
  }

  const messages: DmMessage[] = [];
  for (const entry of timeline.entries ?? []) {
    const msg = parseMessageEntry(entry);
    if (msg) messages.push(msg);
  }

  return new DmConversationPage({
    conversationId,
    messages,
    ...(timeline.status ? { status: timeline.status } : {}),
    ...(timeline.min_entry_id
      ? { minEntryId: timeline.min_entry_id }
      : {}),
    ...(timeline.max_entry_id
      ? { maxEntryId: timeline.max_entry_id }
      : {}),
  });
};
