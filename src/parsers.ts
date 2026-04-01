import { InvalidResponseError, ProfileNotFoundError } from "./errors";
import type { Profile, TimelinePage, Tweet } from "./models";
import type { TweetDetailDocument } from "./tweet-detail-model";
import { buildTweetDetailDocument } from "./tweet-detail-builder";

interface UrlEntityRaw {
  readonly expanded_url?: string;
  readonly url?: string;
}

interface MentionRaw {
  readonly id_str?: string;
  readonly screen_name?: string;
  readonly name?: string;
}

interface LegacyTweetRaw {
  readonly id_str?: string;
  readonly full_text?: string;
  readonly created_at?: string;
  readonly conversation_id_str?: string;
  readonly user_id_str?: string;
  readonly favorite_count?: number;
  readonly reply_count?: number;
  readonly retweet_count?: number;
  readonly quoted_status_id_str?: string;
  readonly in_reply_to_status_id_str?: string;
  readonly retweeted_status_id_str?: string;
  readonly entities?: {
    readonly hashtags?: ReadonlyArray<{ readonly text?: string }>;
    readonly urls?: ReadonlyArray<UrlEntityRaw>;
    readonly user_mentions?: ReadonlyArray<MentionRaw>;
  };
}

interface CoreUserRaw {
  readonly created_at?: string;
  readonly name?: string;
  readonly screen_name?: string;
}

interface LegacyUserRaw {
  readonly created_at?: string;
  readonly description?: string;
  readonly entities?: {
    readonly url?: {
      readonly urls?: ReadonlyArray<{
        readonly expanded_url?: string;
      }>;
    };
  };
  readonly favourites_count?: number;
  readonly followers_count?: number;
  readonly friends_count?: number;
  readonly media_count?: number;
  readonly statuses_count?: number;
  readonly id_str?: string;
  readonly listed_count?: number;
  readonly name?: string;
  readonly location?: string;
  readonly pinned_tweet_ids_str?: ReadonlyArray<string>;
  readonly profile_banner_url?: string;
  readonly profile_image_url_https?: string;
  readonly protected?: boolean;
  readonly screen_name?: string;
  readonly verified?: boolean;
  readonly can_dm?: boolean;
}

interface UserByScreenNameResponse {
  readonly data?: {
    readonly user?: {
      readonly result?: {
        readonly __typename?: string;
        readonly reason?: string;
        readonly rest_id?: string;
        readonly is_blue_verified?: boolean;
        readonly legacy?: LegacyUserRaw;
        readonly core?: CoreUserRaw;
        readonly avatar?: {
          readonly image_url?: string;
        };
        readonly location?: {
          readonly location?: string;
        };
      };
    };
  };
}

interface TimelineResultRaw {
  readonly __typename?: string;
  readonly rest_id?: string;
  readonly tweet?: TimelineResultRaw;
  readonly legacy?: LegacyTweetRaw;
  readonly core?: {
    readonly user_results?: {
      readonly result?: {
        readonly legacy?: LegacyUserRaw;
        readonly core?: CoreUserRaw;
      };
    };
  };
  readonly note_tweet?: {
    readonly note_tweet_results?: {
      readonly result?: {
        readonly text?: string;
      };
    };
  };
  readonly views?: {
    readonly count?: string;
  };
}

interface TimelineEntryItemContentRaw {
  readonly tweet_results?: {
    readonly result?: TimelineResultRaw;
  };
  readonly tweetResult?: {
    readonly result?: TimelineResultRaw;
  };
}

interface TimelineEntryRaw {
  readonly entryId: string;
  readonly content?: {
    readonly cursorType?: string;
    readonly value?: string;
    readonly itemContent?: TimelineEntryItemContentRaw;
    readonly items?: ReadonlyArray<{
      readonly item?: {
        readonly itemContent?: TimelineEntryItemContentRaw;
        readonly content?: TimelineEntryItemContentRaw;
      };
    }>;
  };
}

interface TimelineInstructionRaw {
  readonly entries?: ReadonlyArray<TimelineEntryRaw>;
  readonly entry?: TimelineEntryRaw;
}

interface UserTweetsResponse {
  readonly data?: {
    readonly user?: {
      readonly result?: {
        readonly timeline?: {
          readonly timeline?: {
            readonly instructions?: ReadonlyArray<TimelineInstructionRaw>;
          };
        };
      };
    };
  };
}

interface SearchUserResultRaw {
  readonly rest_id?: string;
  readonly is_blue_verified?: boolean;
  readonly legacy?: LegacyUserRaw;
  readonly core?: CoreUserRaw;
}

interface SearchEntryItemContentRaw {
  readonly tweetDisplayType?: string;
  readonly tweet_results?: {
    readonly result?: TimelineResultRaw;
  };
  readonly userDisplayType?: string;
  readonly user_results?: {
    readonly result?: SearchUserResultRaw;
  };
}

interface SearchEntryRaw {
  readonly entryId: string;
  readonly content?: {
    readonly cursorType?: string;
    readonly value?: string;
    readonly itemContent?: SearchEntryItemContentRaw;
  };
}

interface SearchInstructionRaw {
  readonly type?: string;
  readonly entries?: ReadonlyArray<SearchEntryRaw>;
  readonly entry?: SearchEntryRaw;
}

interface SearchTimelineResponse {
  readonly data?: {
    readonly search_by_raw_query?: {
      readonly search_timeline?: {
        readonly timeline?: {
          readonly instructions?: ReadonlyArray<SearchInstructionRaw>;
        };
      };
    };
  };
}

interface RelationshipTimelineResponse {
  readonly data?: {
    readonly user?: {
      readonly result?: {
        readonly timeline?: {
          readonly timeline?: {
            readonly instructions?: ReadonlyArray<SearchInstructionRaw>;
          };
        };
      };
    };
  };
}

interface TrendsGuideResponse {
  readonly timeline?: {
    readonly instructions?: ReadonlyArray<{
      readonly addEntries?: {
        readonly entries?: ReadonlyArray<{
          readonly content?: {
            readonly timelineModule?: {
              readonly items?: ReadonlyArray<{
                readonly item?: {
                  readonly clientEventInfo?: {
                    readonly details?: {
                      readonly guideDetails?: {
                        readonly transparentGuideDetails?: {
                          readonly trendMetadata?: {
                            readonly trendName?: string;
                          };
                        };
                      };
                    };
                  };
                };
              }>;
            };
          };
        }>;
      };
    }>;
  };
}

const getAvatarOriginalSizeUrl = (avatarUrl: string | undefined) =>
  avatarUrl ? avatarUrl.replace("_normal", "") : undefined;

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

const extractTweetResult = (content: TimelineEntryItemContentRaw) => {
  const rawResult = content.tweet_results?.result ?? content.tweetResult?.result;
  if (!rawResult) {
    return undefined;
  }

  if (rawResult.__typename === "TweetWithVisibilityResults" && rawResult.tweet) {
    return rawResult.tweet;
  }

  return rawResult;
};

const parseTweet = (
  content: TimelineEntryItemContentRaw,
  entryId: string,
): Tweet | undefined => {
  const result = extractTweetResult(content);
  const legacy = result?.legacy;
  const userLegacy = result?.core?.user_results?.result?.legacy;
  const userCore = result?.core?.user_results?.result?.core;
  if (!legacy || !userLegacy) {
    return undefined;
  }

  const id =
    result?.rest_id ??
    legacy.id_str ??
    entryId.replace(/^tweet-/, "").replace(/^conversation-/, "");
  const username = userLegacy.screen_name ?? userCore?.screen_name;
  const name = userLegacy.name ?? userCore?.name;
  const text =
    result?.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text;
  const { timeParsed, timestamp } = parseTimestamp(legacy.created_at);
  const viewsText = result?.views?.count;
  const views = viewsText ? Number.parseInt(viewsText, 10) : undefined;

  return {
    id,
    ...(legacy.conversation_id_str
      ? { conversationId: legacy.conversation_id_str }
      : {}),
    hashtags:
      legacy.entities?.hashtags
        ?.flatMap((hashtag) => (hashtag.text ? [hashtag.text] : [])) ?? [],
    mentions:
      legacy.entities?.user_mentions
        ?.flatMap((mention) =>
          mention.id_str
            ? [
                {
                  id: mention.id_str,
                  ...(mention.screen_name
                    ? { username: mention.screen_name }
                    : {}),
                  ...(mention.name ? { name: mention.name } : {}),
                },
              ]
            : [],
        ) ?? [],
    ...(name ? { name } : {}),
    ...(username && id
      ? { permanentUrl: `https://x.com/${username}/status/${id}` }
      : {}),
    ...(text ? { text } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(timeParsed ? { timeParsed } : {}),
    urls:
      legacy.entities?.urls?.flatMap((url) =>
        url.expanded_url ?? url.url ? [url.expanded_url ?? url.url!] : [],
      ) ?? [],
    ...(legacy.user_id_str ? { userId: legacy.user_id_str } : {}),
    ...(username ? { username } : {}),
    ...(views !== undefined && !Number.isNaN(views) ? { views } : {}),
    ...(legacy.favorite_count !== undefined
      ? { likes: legacy.favorite_count }
      : {}),
    ...(legacy.reply_count !== undefined ? { replies: legacy.reply_count } : {}),
    ...(legacy.retweet_count !== undefined
      ? { retweets: legacy.retweet_count }
      : {}),
    isQuoted: legacy.quoted_status_id_str !== undefined,
    isReply: legacy.in_reply_to_status_id_str !== undefined,
    isRetweet: legacy.retweeted_status_id_str !== undefined,
    ...(legacy.quoted_status_id_str
      ? { quotedTweetId: legacy.quoted_status_id_str }
      : {}),
    ...(legacy.in_reply_to_status_id_str
      ? { inReplyToTweetId: legacy.in_reply_to_status_id_str }
      : {}),
    ...(legacy.retweeted_status_id_str
      ? { retweetedTweetId: legacy.retweeted_status_id_str }
      : {}),
  } as Tweet;
};

const parseUserProfile = (input: {
  readonly legacy: LegacyUserRaw | undefined;
  readonly restId: string | undefined;
  readonly isBlueVerified: boolean | undefined;
  readonly core: CoreUserRaw | undefined;
  readonly avatarUrl?: string | undefined;
  readonly location?: string | undefined;
}) => {
  const legacy = input.legacy;
  if (!legacy) {
    return undefined;
  }

  const userId = input.restId ?? legacy.id_str;
  const screenName = legacy.screen_name ?? input.core?.screen_name;
  if (!userId || !screenName) {
    return undefined;
  }

  const joined =
    legacy.created_at ?? input.core?.created_at
      ? new Date(Date.parse(legacy.created_at ?? input.core?.created_at ?? ""))
      : undefined;

  const avatar = getAvatarOriginalSizeUrl(
    legacy.profile_image_url_https ?? input.avatarUrl,
  );

  return {
    ...(avatar ? { avatar } : {}),
    ...(legacy.profile_banner_url ? { banner: legacy.profile_banner_url } : {}),
    ...(legacy.description ? { biography: legacy.description } : {}),
    ...(legacy.followers_count !== undefined
      ? { followersCount: legacy.followers_count }
      : {}),
    ...(legacy.friends_count !== undefined
      ? { followingCount: legacy.friends_count }
      : {}),
    ...(legacy.media_count !== undefined ? { mediaCount: legacy.media_count } : {}),
    ...(legacy.statuses_count !== undefined
      ? { tweetsCount: legacy.statuses_count }
      : {}),
    isPrivate: legacy.protected ?? false,
    ...(legacy.verified !== undefined ? { isVerified: legacy.verified } : {}),
    isBlueVerified: input.isBlueVerified ?? false,
    ...(joined && !Number.isNaN(joined.valueOf()) ? { joined } : {}),
    ...(legacy.favourites_count !== undefined
      ? { likesCount: legacy.favourites_count }
      : {}),
    ...(legacy.listed_count !== undefined
      ? { listedCount: legacy.listed_count }
      : {}),
    ...(legacy.location ?? input.location
      ? { location: legacy.location ?? input.location }
      : {}),
    ...(legacy.name ?? input.core?.name
      ? { name: legacy.name ?? input.core?.name }
      : {}),
    pinnedTweetIds: legacy.pinned_tweet_ids_str ?? [],
    url: `https://x.com/${screenName}`,
    userId,
    username: screenName,
    ...(legacy.entities?.url?.urls?.[0]?.expanded_url
      ? { website: legacy.entities.url.urls[0].expanded_url }
      : {}),
    ...(legacy.can_dm !== undefined ? { canDm: legacy.can_dm } : {}),
  } as Profile;
};

export const parseProfileResponse = (
  body: unknown,
  username: string,
): Profile => {
  const response = body as UserByScreenNameResponse;
  const user = response.data?.user?.result;
  if (!user) {
    throw new ProfileNotFoundError({ username });
  }

  if (user.__typename === "UserUnavailable" && user.reason === "Suspended") {
    throw new ProfileNotFoundError({ username });
  }

  const profile = parseUserProfile({
    legacy: user.legacy,
    restId: user.rest_id,
    isBlueVerified: user.is_blue_verified,
    core: user.core,
    avatarUrl: user.avatar?.image_url,
    location: user.location?.location,
  });
  if (!profile) {
    throw new ProfileNotFoundError({ username });
  }

  return profile;
};

export const parseSearchProfilesResponse = (
  body: unknown,
): TimelinePage<Profile> => {
  const response = body as SearchTimelineResponse;
  const instructions =
    response.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
  return parseProfilesTimelinePage(instructions, {
    endpointId: "SearchProfiles",
    missingReason: "Missing search timeline instructions in Twitter response",
  });
};

export const parseFollowersPageResponse = (
  body: unknown,
): TimelinePage<Profile> => {
  const response = body as RelationshipTimelineResponse;
  const instructions = response.data?.user?.result?.timeline?.timeline?.instructions;
  return parseProfilesTimelinePage(instructions, {
    endpointId: "Followers",
    missingReason: "Missing followers timeline instructions in Twitter response",
  });
};

export const parseFollowingPageResponse = (
  body: unknown,
): TimelinePage<Profile> => {
  const response = body as RelationshipTimelineResponse;
  const instructions = response.data?.user?.result?.timeline?.timeline?.instructions;
  return parseProfilesTimelinePage(instructions, {
    endpointId: "Following",
    missingReason: "Missing following timeline instructions in Twitter response",
  });
};

const getInstructionEntries = <TEntry>(instruction: {
  readonly entries?: ReadonlyArray<TEntry>;
  readonly entry?: TEntry;
}) => [
  ...(instruction.entries ?? []),
  ...(instruction.entry ? [instruction.entry] : []),
];

const parseSearchProfile = (
  itemContent: SearchEntryItemContentRaw,
): Profile | undefined => {
  if (itemContent.userDisplayType !== "User") {
    return undefined;
  }

  const user = itemContent.user_results?.result;
  return parseUserProfile({
    legacy: user?.legacy,
    restId: user?.rest_id,
    isBlueVerified: user?.is_blue_verified,
    core: user?.core,
  });
};

const parseProfilesTimelinePage = (
  instructions: ReadonlyArray<SearchInstructionRaw> | undefined,
  options: {
    readonly endpointId: "Followers" | "Following" | "SearchProfiles";
    readonly missingReason: string;
  },
): TimelinePage<Profile> => {
  if (!instructions) {
    throw new InvalidResponseError({
      endpointId: options.endpointId,
      reason: options.missingReason,
    });
  }

  let nextCursor: string | undefined;
  let previousCursor: string | undefined;
  const items: Profile[] = [];

  for (const instruction of instructions) {
    if (
      instruction.type &&
      instruction.type !== "TimelineAddEntries" &&
      instruction.type !== "TimelineReplaceEntry"
      ) {
      continue;
    }

    const entries = getInstructionEntries(instruction);

    for (const entry of entries) {
      if (entry.content?.cursorType === "Bottom") {
        nextCursor = entry.content.value;
        continue;
      }

      if (entry.content?.cursorType === "Top") {
        previousCursor = entry.content.value;
        continue;
      }

      const profile = entry.content?.itemContent
        ? parseSearchProfile(entry.content.itemContent)
        : undefined;

      if (profile) {
        items.push(profile);
      }
    }
  }

  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
    ...(previousCursor ? { previousCursor } : {}),
    status: nextCursor ? "has_more" : "at_end",
  } as TimelinePage<Profile>;
};

const parseTweetsTimelinePage = (
  instructions: ReadonlyArray<TimelineInstructionRaw> | undefined,
  options: {
    readonly endpointId: "Likes" | "UserTweets" | "UserTweetsAndReplies";
    readonly missingReason: string;
  },
): TimelinePage<Tweet> => {
  if (!instructions) {
    throw new InvalidResponseError({
      endpointId: options.endpointId,
      reason: options.missingReason,
    });
  }

  let nextCursor: string | undefined;
  let previousCursor: string | undefined;
  const items: Tweet[] = [];

  for (const instruction of instructions) {
    const entries = getInstructionEntries(instruction);

    for (const entry of entries) {
      if (entry.content?.cursorType === "Bottom") {
        nextCursor = entry.content.value;
        continue;
      }

      if (entry.content?.cursorType === "Top") {
        previousCursor = entry.content.value;
        continue;
      }

      if (
        !entry.entryId.startsWith("tweet") &&
        !entry.entryId.startsWith("profile-conversation")
      ) {
        continue;
      }

      const directItem = entry.content?.itemContent;
      if (directItem) {
        const tweet = parseTweet(directItem, entry.entryId);
        if (tweet) {
          items.push(tweet);
        }
      }

      for (const item of entry.content?.items ?? []) {
        const moduleItem = item.item?.itemContent ?? item.item?.content;
        if (!moduleItem) {
          continue;
        }

        const tweet = parseTweet(moduleItem, entry.entryId);
        if (tweet) {
          items.push(tweet);
        }
      }
    }
  }

  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
    ...(previousCursor ? { previousCursor } : {}),
    status: nextCursor ? "has_more" : "at_end",
  } as TimelinePage<Tweet>;
};

export const parseTimelinePageResponse = (body: unknown): TimelinePage<Tweet> => {
  const response = body as UserTweetsResponse;
  const instructions =
    response.data?.user?.result?.timeline?.timeline?.instructions;

  return parseTweetsTimelinePage(instructions, {
    endpointId: "UserTweets",
    missingReason: "Missing timeline instructions in Twitter response",
  });
};

export const parseTweetsAndRepliesPageResponse = (
  body: unknown,
): TimelinePage<Tweet> => {
  const response = body as UserTweetsResponse;
  const instructions =
    response.data?.user?.result?.timeline?.timeline?.instructions;

  return parseTweetsTimelinePage(instructions, {
    endpointId: "UserTweetsAndReplies",
    missingReason:
      "Missing tweets-and-replies timeline instructions in Twitter response",
  });
};

export const parseLikedTweetsPageResponse = (
  body: unknown,
): TimelinePage<Tweet> => {
  const response = body as UserTweetsResponse;
  const instructions =
    response.data?.user?.result?.timeline?.timeline?.instructions;

  return parseTweetsTimelinePage(instructions, {
    endpointId: "Likes",
    missingReason: "Missing liked tweets timeline instructions in Twitter response",
  });
};

const parseSearchTweetsTimelinePage = (
  instructions: ReadonlyArray<SearchInstructionRaw> | undefined,
): TimelinePage<Tweet> => {
  if (!instructions) {
    throw new InvalidResponseError({
      endpointId: "SearchTweets",
      reason: "Missing search timeline instructions in Twitter response",
    });
  }

  let nextCursor: string | undefined;
  let previousCursor: string | undefined;
  const items: Tweet[] = [];

  for (const instruction of instructions) {
    if (
      instruction.type &&
      instruction.type !== "TimelineAddEntries" &&
      instruction.type !== "TimelineReplaceEntry"
    ) {
      continue;
    }

    const entries = getInstructionEntries(instruction);

    for (const entry of entries) {
      if (entry.content?.cursorType === "Bottom") {
        nextCursor = entry.content.value;
        continue;
      }

      if (entry.content?.cursorType === "Top") {
        previousCursor = entry.content.value;
        continue;
      }

      const itemContent = entry.content?.itemContent;
      if (itemContent?.tweetDisplayType !== "Tweet") {
        continue;
      }

      const tweet = parseTweet(
        itemContent as unknown as TimelineEntryItemContentRaw,
        entry.entryId,
      );

      if (tweet) {
        items.push(tweet);
      }
    }
  }

  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
    ...(previousCursor ? { previousCursor } : {}),
    status: nextCursor ? "has_more" : "at_end",
  } as TimelinePage<Tweet>;
};

export const parseSearchTweetsResponse = (
  body: unknown,
): TimelinePage<Tweet> => {
  const response = body as SearchTimelineResponse;
  const instructions =
    response.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;

  return parseSearchTweetsTimelinePage(instructions);
};

export const parseTrendsResponse = (body: unknown): readonly string[] => {
  const response = body as TrendsGuideResponse;
  const instructions = response.timeline?.instructions;
  const entries = instructions?.[1]?.addEntries?.entries;
  const items = entries?.[1]?.content?.timelineModule?.items;

  if (!instructions || !entries || !items) {
    throw new InvalidResponseError({
      endpointId: "Trends",
      reason: "Missing trends guide entries in Twitter response",
    });
  }

  return items.flatMap((item) => {
    const trendName =
      item.item?.clientEventInfo?.details?.guideDetails?.transparentGuideDetails
        ?.trendMetadata?.trendName;

    return trendName ? [trendName] : [];
  });
};

export const parseTweetDetailResponse = (
  body: unknown,
  focalTweetId: string,
): TweetDetailDocument => buildTweetDetailDocument(body, focalTweetId);
