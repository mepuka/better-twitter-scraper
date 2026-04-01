import * as Graph from "effect/Graph";
import * as Option from "effect/Option";

import type {
  LegacyTweetRaw,
  TimelineInstructionRaw,
  TimelineMediaExtendedRaw,
  TimelineResultRaw,
} from "./api-types";
import { InvalidResponseError, TweetNotFoundError } from "./errors";
import {
  TweetDetailDocument,
  TweetDetailNode,
  TweetPhoto,
  TweetRelation,
  type TweetRelationKind,
  TweetVideo,
} from "./tweet-detail-model";

interface TweetDetailResponse {
  readonly data?: {
    readonly threaded_conversation_with_injections_v2?: {
      readonly instructions?: ReadonlyArray<TimelineInstructionRaw>;
    };
  };
}

interface RelationObservation {
  readonly kind: TweetRelationKind;
  readonly sourceTweetId: string;
  readonly targetTweetId: string;
}

interface ParsedTweetObservation {
  readonly node: TweetDetailNode;
  readonly quotedResult?: TimelineResultRaw;
  readonly relationObservations: readonly RelationObservation[];
  readonly retweetedResult?: TimelineResultRaw;
}

const HASH_TAG_RE = /\B(\#\S+\b)/g;
const CASH_TAG_RE = /\B(\$\S+\b)/g;
const TWITTER_URL_RE = /https:(\/\/t\.co\/([A-Za-z0-9]|[A-Za-z]){10})/g;
const USERNAME_RE = /\B(\@\S{1,15}\b)/g;

const invalidTweetDetailResponse = (reason: string) =>
  new InvalidResponseError({
    endpointId: "TweetDetail",
    reason,
  });

const parseCount = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseTimestamp = (createdAt: string | undefined) => {
  if (!createdAt) {
    return {
      timeParsed: undefined,
      timestamp: undefined,
    };
  }

  const timeParsed = new Date(Date.parse(createdAt));
  if (Number.isNaN(timeParsed.valueOf())) {
    return {
      timeParsed: undefined,
      timestamp: undefined,
    };
  }

  return {
    timeParsed,
    timestamp: Math.floor(timeParsed.valueOf() / 1000),
  };
};

const uniqueStrings = (values: ReadonlyArray<string>) => [...new Set(values)];

const uniqueMentions = (values: TweetDetailNode["mentions"]) => {
  const seen = new Set<string>();
  const result: Array<(typeof values)[number]> = [];

  for (const value of values) {
    const key = `${value.id}:${value.username ?? ""}:${value.name ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
};

const uniquePhotos = (values: TweetDetailNode["photos"]) => {
  const seen = new Set<string>();
  const result: Array<(typeof values)[number]> = [];

  for (const value of values) {
    const key = `${value.id}:${value.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
};

const uniqueVideos = (values: TweetDetailNode["videos"]) => {
  const seen = new Set<string>();
  const result: Array<(typeof values)[number]> = [];

  for (const value of values) {
    const key = `${value.id}:${value.url ?? value.preview}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
};

const parseMediaGroups = (media: ReadonlyArray<TimelineMediaExtendedRaw>) => {
  let sensitiveContent = false;
  const photos: Array<TweetPhoto> = [];
  const videos: Array<TweetVideo> = [];

  for (const item of media) {
    if (!item.id_str || !item.media_url_https) {
      continue;
    }

    if (item.type === "photo") {
      photos.push(
        new TweetPhoto({
          ...(item.ext_alt_text ? { altText: item.ext_alt_text } : {}),
          id: item.id_str,
          url: item.media_url_https,
        }),
      );
    } else if (item.type === "animated_gif" || item.type === "video") {
      let preview = item.media_url_https;
      let selectedUrl: string | undefined;
      let maxBitrate = 0;

      for (const variant of item.video_info?.variants ?? []) {
        if (
          variant.content_type === "video/mp4" &&
          variant.url &&
          (variant.bitrate ?? 0) >= maxBitrate
        ) {
          selectedUrl = variant.url;
          maxBitrate = variant.bitrate ?? 0;
        }
      }

      if (item.type === "animated_gif" && selectedUrl) {
        preview = selectedUrl;
      }

      videos.push(
        new TweetVideo({
          id: item.id_str,
          preview,
          ...(selectedUrl ? { url: selectedUrl } : {}),
        }),
      );
    }

    const warning = item.ext_sensitive_media_warning;
    if (
      warning?.adult_content ||
      warning?.graphic_violence ||
      warning?.other
    ) {
      sensitiveContent = true;
    }
  }

  return {
    photos,
    sensitiveContent,
    videos,
  };
};

const linkHashtagHtml = (value: string) =>
  `<a href="https://x.com/hashtag/${value.replace("#", "")}">${value}</a>`;

const linkCashtagHtml = (value: string) =>
  `<a href="https://x.com/search?q=%24${value.replace("$", "")}">${value}</a>`;

const linkUsernameHtml = (value: string) =>
  `<a href="https://x.com/${value.replace("@", "")}">${value}</a>`;

const reconstructTweetHtml = (
  legacy: LegacyTweetRaw,
  text: string | undefined,
  photos: ReadonlyArray<TweetPhoto>,
  videos: ReadonlyArray<TweetVideo>,
) => {
  const includedMedia = new Set<string>();
  let html = text ?? "";

  html = html.replace(HASH_TAG_RE, linkHashtagHtml);
  html = html.replace(CASH_TAG_RE, linkCashtagHtml);
  html = html.replace(USERNAME_RE, linkUsernameHtml);
  html = html.replace(TWITTER_URL_RE, (tco) => {
    for (const url of legacy.entities?.urls ?? []) {
      if (url.url === tco && url.expanded_url) {
        return `<a href="${url.expanded_url}">${tco}</a>`;
      }
    }

    for (const media of legacy.extended_entities?.media ?? []) {
      if (media.url === tco && media.media_url_https) {
        includedMedia.add(media.media_url_https);
        return `<br><a href="${tco}"><img src="${media.media_url_https}"/></a>`;
      }
    }

    return tco;
  });

  for (const photo of photos) {
    if (!includedMedia.has(photo.url)) {
      html += `<br><img src="${photo.url}"/>`;
    }
  }

  for (const video of videos) {
    if (!includedMedia.has(video.preview)) {
      html += `<br><img src="${video.preview}"/>`;
    }
  }

  return html.replace(/\n/g, "<br>");
};

const extractTimelineResult = (result: TimelineResultRaw | undefined) => {
  if (!result) {
    return undefined;
  }

  if (result.__typename === "TweetWithVisibilityResults" && result.tweet) {
    return result.tweet;
  }

  return result;
};

const createPlaceholderNode = (id: string) =>
  new TweetDetailNode({
    hashtags: [],
    id,
    isEdited: false,
    isPin: false,
    isQuoted: false,
    isReply: false,
    isRetweet: false,
    isSelfThread: false,
    mentions: [],
    photos: [],
    resolution: "reference",
    sensitiveContent: false,
    urls: [],
    versions: [id],
    videos: [],
  });

const mergeDetailNodes = (
  left: TweetDetailNode,
  right: TweetDetailNode,
) =>
  new TweetDetailNode({
    ...(left.bookmarkCount !== undefined
      ? { bookmarkCount: left.bookmarkCount }
      : right.bookmarkCount !== undefined
        ? { bookmarkCount: right.bookmarkCount }
        : {}),
    ...(left.conversationId
      ? { conversationId: left.conversationId }
      : right.conversationId
        ? { conversationId: right.conversationId }
        : {}),
    hashtags: uniqueStrings([...left.hashtags, ...right.hashtags]),
    ...(left.html ? { html: left.html } : right.html ? { html: right.html } : {}),
    id: left.id,
    isEdited: left.isEdited || right.isEdited,
    isPin: left.isPin || right.isPin,
    isQuoted: left.isQuoted || right.isQuoted,
    isReply: left.isReply || right.isReply,
    isRetweet: left.isRetweet || right.isRetweet,
    isSelfThread: left.isSelfThread || right.isSelfThread,
    ...(left.likes !== undefined
      ? { likes: left.likes }
      : right.likes !== undefined
        ? { likes: right.likes }
        : {}),
    mentions: uniqueMentions([...left.mentions, ...right.mentions]),
    ...(left.name ? { name: left.name } : right.name ? { name: right.name } : {}),
    ...(left.permanentUrl
      ? { permanentUrl: left.permanentUrl }
      : right.permanentUrl
        ? { permanentUrl: right.permanentUrl }
        : {}),
    photos: uniquePhotos([...left.photos, ...right.photos]),
    ...(left.place ? { place: left.place } : right.place ? { place: right.place } : {}),
    resolution:
      left.resolution === "full" || right.resolution === "full"
        ? "full"
        : "reference",
    ...(left.replies !== undefined
      ? { replies: left.replies }
      : right.replies !== undefined
        ? { replies: right.replies }
        : {}),
    ...(left.retweets !== undefined
      ? { retweets: left.retweets }
      : right.retweets !== undefined
        ? { retweets: right.retweets }
        : {}),
    sensitiveContent: left.sensitiveContent || right.sensitiveContent,
    ...(left.text ? { text: left.text } : right.text ? { text: right.text } : {}),
    ...(left.timeParsed
      ? { timeParsed: left.timeParsed }
      : right.timeParsed
        ? { timeParsed: right.timeParsed }
        : {}),
    ...(left.timestamp !== undefined
      ? { timestamp: left.timestamp }
      : right.timestamp !== undefined
        ? { timestamp: right.timestamp }
        : {}),
    urls: uniqueStrings([...left.urls, ...right.urls]),
    ...(left.userId
      ? { userId: left.userId }
      : right.userId
        ? { userId: right.userId }
        : {}),
    ...(left.username
      ? { username: left.username }
      : right.username
        ? { username: right.username }
        : {}),
    versions: uniqueStrings([...left.versions, ...right.versions]),
    videos: uniqueVideos([...left.videos, ...right.videos]),
    ...(left.views !== undefined
      ? { views: left.views }
      : right.views !== undefined
        ? { views: right.views }
        : {}),
  });

const parseTweetObservation = (
  result: TimelineResultRaw | undefined,
  options: {
    readonly entryId: string;
    readonly isConversation: boolean;
    readonly tweetDisplayType?: string;
  },
): ParsedTweetObservation | undefined => {
  const parsedResult = extractTimelineResult(result);
  const legacy = parsedResult?.legacy;
  const userLegacy = parsedResult?.core?.user_results?.result?.legacy;
  const userCore = parsedResult?.core?.user_results?.result?.core;

  if (!parsedResult || !legacy) {
    return undefined;
  }

  const id =
    parsedResult.rest_id ??
    legacy.id_str ??
    options.entryId.replace(/^conversation-/, "").replace(/^tweet-/, "");

  if (!id) {
    return undefined;
  }

  const username = userLegacy?.screen_name ?? userCore?.screen_name;
  const text =
    parsedResult.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text;
  const { photos, sensitiveContent, videos } = parseMediaGroups(
    legacy.extended_entities?.media ?? [],
  );
  const { timeParsed, timestamp } = parseTimestamp(legacy.created_at);
  const versions = [
    ...(parsedResult.edit_control?.edit_control_initial?.edit_tweet_ids ?? [id]),
  ];
  const views = parseCount(parsedResult.views?.count ?? legacy.ext_views?.count);
  const displayName = userLegacy?.name ?? userCore?.name;
  const permanentUrl = username ? `https://x.com/${username}/status/${id}` : undefined;

  const relationObservations: RelationObservation[] = [];

  if (legacy.in_reply_to_status_id_str) {
    relationObservations.push({
      kind: "reply_to",
      sourceTweetId: id,
      targetTweetId: legacy.in_reply_to_status_id_str,
    });
  }

  const quotedId =
    legacy.quoted_status_id_str ??
    extractTimelineResult(parsedResult.quoted_status_result?.result)?.rest_id ??
    extractTimelineResult(parsedResult.quoted_status_result?.result)?.legacy?.id_str;
  if (quotedId) {
    relationObservations.push({
      kind: "quotes",
      sourceTweetId: id,
      targetTweetId: quotedId,
    });
  }

  const retweetedId =
    legacy.retweeted_status_id_str ??
    extractTimelineResult(legacy.retweeted_status_result?.result)?.rest_id ??
    extractTimelineResult(legacy.retweeted_status_result?.result)?.legacy?.id_str;
  if (retweetedId) {
    relationObservations.push({
      kind: "retweets",
      sourceTweetId: id,
      targetTweetId: retweetedId,
    });
  }

  const isSelfThread =
    options.isConversation && options.tweetDisplayType === "SelfThread";
  if (isSelfThread && legacy.conversation_id_str && legacy.conversation_id_str !== id) {
    relationObservations.push({
      kind: "thread_root",
      sourceTweetId: id,
      targetTweetId: legacy.conversation_id_str,
    });
  }

  return {
    node: new TweetDetailNode({
      ...(legacy.bookmark_count !== undefined
        ? { bookmarkCount: legacy.bookmark_count }
        : {}),
      ...(legacy.conversation_id_str
        ? { conversationId: legacy.conversation_id_str }
        : {}),
      hashtags:
        legacy.entities?.hashtags?.flatMap((hashtag) =>
          hashtag.text ? [hashtag.text] : [],
        ) ?? [],
      ...(text ? { html: reconstructTweetHtml(legacy, text, photos, videos) } : {}),
      id,
      isEdited: versions.length > 1,
      isPin: Boolean(userLegacy?.pinned_tweet_ids_str?.includes(id)),
      isQuoted: quotedId !== undefined,
      isReply: legacy.in_reply_to_status_id_str !== undefined,
      isRetweet: retweetedId !== undefined,
      isSelfThread,
      ...(legacy.favorite_count !== undefined
        ? { likes: legacy.favorite_count }
        : {}),
      mentions:
        legacy.entities?.user_mentions?.flatMap((mention) =>
          mention.id_str
            ? [
                {
                  id: mention.id_str,
                  ...(mention.name ? { name: mention.name } : {}),
                  ...(mention.screen_name
                    ? { username: mention.screen_name }
                    : {}),
                },
              ]
            : [],
        ) ?? [],
      ...(displayName ? { name: displayName } : {}),
      ...(permanentUrl ? { permanentUrl } : {}),
      photos,
      ...(legacy.place
        ? {
            place: {
              ...(legacy.place.bounding_box
                ? {
                    boundingBox: {
                      ...(legacy.place.bounding_box.coordinates
                        ? { coordinates: legacy.place.bounding_box.coordinates }
                        : {}),
                      ...(legacy.place.bounding_box.type
                        ? { type: legacy.place.bounding_box.type }
                        : {}),
                    },
                  }
                : {}),
              ...(legacy.place.country ? { country: legacy.place.country } : {}),
              ...(legacy.place.country_code
                ? { countryCode: legacy.place.country_code }
                : {}),
              ...(legacy.place.full_name
                ? { fullName: legacy.place.full_name }
                : {}),
              ...(legacy.place.id ? { id: legacy.place.id } : {}),
              ...(legacy.place.name ? { name: legacy.place.name } : {}),
              ...(legacy.place.place_type
                ? { placeType: legacy.place.place_type }
                : {}),
            },
          }
        : {}),
      resolution: "full",
      ...(legacy.reply_count !== undefined ? { replies: legacy.reply_count } : {}),
      ...(legacy.retweet_count !== undefined
        ? { retweets: legacy.retweet_count }
        : {}),
      sensitiveContent,
      ...(text ? { text } : {}),
      ...(timeParsed ? { timeParsed } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
      urls:
        legacy.entities?.urls?.flatMap((url) =>
          url.expanded_url ?? url.url ? [url.expanded_url ?? url.url!] : [],
        ) ?? [],
      ...(legacy.user_id_str ? { userId: legacy.user_id_str } : {}),
      ...(username ? { username } : {}),
      versions,
      videos,
      ...(views !== undefined ? { views } : {}),
    }),
    relationObservations,
    ...(parsedResult.quoted_status_result?.result
      ? { quotedResult: parsedResult.quoted_status_result.result }
      : {}),
    ...(legacy.retweeted_status_result?.result
      ? { retweetedResult: legacy.retweeted_status_result.result }
      : {}),
  };
};

const collectTweetObservations = (
  result: TimelineResultRaw | undefined,
  options: {
    readonly entryId: string;
    readonly isConversation: boolean;
    readonly tweetDisplayType?: string;
  },
  state: {
    readonly relationObservations: RelationObservation[];
    readonly tweetObservations: TweetDetailNode[];
  },
) => {
  const observation = parseTweetObservation(result, options);
  if (!observation) {
    return;
  }

  state.tweetObservations.push(observation.node);
  state.relationObservations.push(...observation.relationObservations);

  if (observation.quotedResult) {
    collectTweetObservations(
      observation.quotedResult,
      {
        entryId: observation.node.id,
        isConversation: false,
      },
      state,
    );
  }

  if (observation.retweetedResult) {
    collectTweetObservations(
      observation.retweetedResult,
      {
        entryId: observation.node.id,
        isConversation: false,
      },
      state,
    );
  }
};

const getInstructionEntries = (instruction: TimelineInstructionRaw) => [
  ...(instruction.entries ?? []),
  ...(instruction.entry ? [instruction.entry] : []),
];

export const buildTweetDetailDocument = (
  body: unknown,
  focalTweetId: string,
) => {
  const response = body as TweetDetailResponse;
  const instructions =
    response.data?.threaded_conversation_with_injections_v2?.instructions;

  if (!instructions) {
    throw invalidTweetDetailResponse(
      "Missing threaded conversation instructions in Twitter response",
    );
  }

  const tweetObservations: TweetDetailNode[] = [];
  const relationObservations: RelationObservation[] = [];

  for (const instruction of instructions) {
    for (const entry of getInstructionEntries(instruction)) {
      const directItem = entry.content?.itemContent;
      if (directItem) {
        collectTweetObservations(
          directItem.tweet_results?.result ?? directItem.tweetResult?.result,
          {
            entryId: entry.entryId,
            isConversation: true,
            ...(directItem.tweetDisplayType
              ? { tweetDisplayType: directItem.tweetDisplayType }
              : {}),
          },
          {
            relationObservations,
            tweetObservations,
          },
        );
      }

      for (const item of entry.content?.items ?? []) {
        const itemContent = item.item?.itemContent ?? item.item?.content;
        if (!itemContent) {
          continue;
        }

        collectTweetObservations(
          itemContent.tweet_results?.result ?? itemContent.tweetResult?.result,
          {
            entryId: entry.entryId,
            isConversation: true,
            ...(itemContent.tweetDisplayType
              ? { tweetDisplayType: itemContent.tweetDisplayType }
              : {}),
          },
          {
            relationObservations,
            tweetObservations,
          },
        );
      }
    }
  }

  const observedTweetIds = new Set(tweetObservations.map((tweet) => tweet.id));
  if (!observedTweetIds.has(focalTweetId)) {
    throw new TweetNotFoundError({ id: focalTweetId });
  }

  const mergedNodes = new Map<string, TweetDetailNode>();
  const tweetOrder: string[] = [];

  for (const observation of tweetObservations) {
    const existing = mergedNodes.get(observation.id);
    if (!existing) {
      mergedNodes.set(observation.id, observation);
      tweetOrder.push(observation.id);
      continue;
    }

    mergedNodes.set(observation.id, mergeDetailNodes(existing, observation));
  }

  const dedupedRelations = new Map<string, RelationObservation>();
  for (const relation of relationObservations) {
    if (!mergedNodes.has(relation.sourceTweetId)) {
      mergedNodes.set(relation.sourceTweetId, createPlaceholderNode(relation.sourceTweetId));
      tweetOrder.push(relation.sourceTweetId);
    }

    if (!mergedNodes.has(relation.targetTweetId)) {
      mergedNodes.set(relation.targetTweetId, createPlaceholderNode(relation.targetTweetId));
      tweetOrder.push(relation.targetTweetId);
    }

    dedupedRelations.set(
      `${relation.sourceTweetId}:${relation.kind}:${relation.targetTweetId}`,
      relation,
    );
  }

  const nodeIndexes = new Map<string, Graph.NodeIndex>();
  const graph = Graph.mutate(
    Graph.directed<TweetDetailNode, TweetRelationKind>(),
    (mutable) => {
      for (const tweetId of tweetOrder) {
        const node = mergedNodes.get(tweetId);
        if (!node) {
          throw invalidTweetDetailResponse(
            `Missing canonical node for tweet ${tweetId} during graph construction`,
          );
        }

        nodeIndexes.set(tweetId, Graph.addNode(mutable, node));
      }

      for (const relation of dedupedRelations.values()) {
        const sourceIndex = nodeIndexes.get(relation.sourceTweetId);
        const targetIndex = nodeIndexes.get(relation.targetTweetId);

        if (sourceIndex === undefined || targetIndex === undefined) {
          throw invalidTweetDetailResponse(
            `Missing node index while linking ${relation.sourceTweetId} -> ${relation.targetTweetId}`,
          );
        }

        Graph.addEdge(mutable, sourceIndex, targetIndex, relation.kind);
      }
    },
  );

  const tweets = tweetOrder.map((tweetId) => {
    const nodeIndex = nodeIndexes.get(tweetId);
    if (nodeIndex === undefined) {
      throw invalidTweetDetailResponse(
        `Missing node index for tweet ${tweetId} during projection`,
      );
    }

    const node = Graph.getNode(graph, nodeIndex);
    if (Option.isNone(node)) {
      throw invalidTweetDetailResponse(
        `Graph node ${tweetId} disappeared during projection`,
      );
    }

    return node.value;
  });

  const relations: TweetRelation[] = [];
  for (const sourceTweetId of tweetOrder) {
    const sourceIndex = nodeIndexes.get(sourceTweetId);
    if (sourceIndex === undefined) {
      continue;
    }

    const outgoing = new Set(Graph.neighborsDirected(graph, sourceIndex, "outgoing"));
    for (const edge of graph.edges.values()) {
      if (edge.source !== sourceIndex || !outgoing.has(edge.target)) {
        continue;
      }

      const sourceNode = Graph.getNode(graph, edge.source);
      const targetNode = Graph.getNode(graph, edge.target);

      if (Option.isNone(sourceNode) || Option.isNone(targetNode)) {
        throw invalidTweetDetailResponse(
          `Graph edge could not be projected for ${sourceTweetId}`,
        );
      }

      relations.push(
        new TweetRelation({
          kind: edge.data,
          sourceTweetId: sourceNode.value.id,
          targetTweetId: targetNode.value.id,
        }),
      );
    }
  }

  relations.sort((left, right) =>
    left.sourceTweetId.localeCompare(right.sourceTweetId) ||
    left.kind.localeCompare(right.kind) ||
    left.targetTweetId.localeCompare(right.targetTweetId),
  );

  return new TweetDetailDocument({
    focalTweetId,
    relations,
    tweets,
  });
};
