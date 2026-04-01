import type { DmConversationPage, DmInbox } from "./dm-models";
import { parseDmConversationResponse, parseDmInboxResponse } from "./dm-parsers";
import type { Profile, TimelinePage, Tweet, TweetSearchMode } from "./models";
import {
  parseFollowersPageResponse,
  parseFollowingPageResponse,
  parseHomeTimelineResponse,
  parseListTweetsPageResponse,
  parseProfileResponse,
  parseSearchProfilesResponse,
  parseSearchTweetsResponse,
  parseTweetDetailResponse,
  parseTweetResultByRestIdResponse,
  parseTrendsResponse,
  parseTweetsAndRepliesPageResponse,
  parseTimelinePageResponse,
  parseLikedTweetsPageResponse,
} from "./parsers";
import type { ApiRequest } from "./request";
import type { TweetDetailDocument } from "./tweet-detail-model";

interface EndpointTemplate {
  readonly variables?: Record<string, unknown>;
  readonly features?: Record<string, unknown>;
  readonly fieldToggles?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mutable query-ID map — initialized with hardcoded fallbacks, updatable at
// runtime via `updateQueryIds()` after endpoint auto-discovery.
// ---------------------------------------------------------------------------

const queryIds = new Map<string, string>([
  ["UserByScreenName", "AWbeRIdkLtqTRN7yL_H8yw"],
  ["UserTweets", "N2tFDY-MlrLxXJ9F_ZxJGA"],
  ["ListLatestTweetsTimeline", "Uv3buKIUElzL3Iuc0L0O5g"],
  ["SearchTimeline", "ML-n2SfAxx5S_9QMqNejbg"],
  ["UserTweetsAndReplies", "2NDLUdBmT_IB5uGwZ3tHRg"],
  ["Likes", "Pcw-j9lrSeDMmkgnIejJiQ"],
  ["Followers", "P7m4Qr-rJEB8KUluOenU6A"],
  ["Following", "T5wihsMTYHncY7BB4YxHSg"],
  ["TweetDetail", "YCNdW_ZytXfV9YR3cJK9kw"],
  ["HomeTimeline", "HJFjzBgCs16TqxewQOeLNg"],
  ["TweetResultByRestId", "4PdbzTmQ5PTjz9RiureISQ"],
]);

/**
 * Replace active query IDs with freshly discovered values.
 * Only updates entries whose operation name already exists in the map
 * so that we don't accidentally add unknown endpoints.
 */
export const updateQueryIds = (discovered: ReadonlyMap<string, string>) => {
  for (const [name, id] of discovered) {
    if (queryIds.has(name)) {
      queryIds.set(name, id);
    }
  }
};

/** Read-only snapshot of the current query-ID map (useful for testing/logging). */
export const getQueryIds = (): ReadonlyMap<string, string> => new Map(queryIds);

const graphqlBaseUrl = (operationName: string) =>
  `https://api.x.com/graphql/${queryIds.get(operationName)}/${operationName}`;

const authenticatedProfilesTimelineFeatures = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
} as const;

const endpointTemplates = {
  userByScreenName: {
    variables: {
      screen_name: "elonmusk",
      withGrokTranslatedBio: true,
    },
    features: {
      hidden_profile_subscriptions_enabled: true,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: false,
      verified_phone_label_enabled: false,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    },
    fieldToggles: {
      withPayments: false,
      withAuxiliaryUserLabels: true,
    },
  },
  userTweets: {
    variables: {
      userId: "44196397",
      count: 20,
      includePromotedContent: true,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
    },
    features: {
      rweb_video_screen_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: false,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: false,
      responsive_web_grok_analyze_post_followups_enabled: true,
      responsive_web_jetfuel_frame: true,
      responsive_web_grok_share_attachment_enabled: true,
      responsive_web_grok_annotations_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      responsive_web_grok_show_grok_translated_post: true,
      responsive_web_grok_analysis_button_from_backend: true,
      post_ctas_fetch_enabled: true,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_imagine_annotation_enabled: true,
      responsive_web_grok_community_note_auto_translation_is_enabled: false,
      responsive_web_enhance_cards_enabled: false,
    },
    fieldToggles: {
      withArticlePlainText: false,
    },
  },
  listTweets: {
    variables: {
      listId: "1736495155002106192",
      count: 20,
    },
    features: authenticatedProfilesTimelineFeatures,
  },
  searchTimeline: {
    variables: {
      rawQuery: "twitter",
      count: 20,
      querySource: "typed_query",
      product: "Top",
      withGrokTranslatedBio: false,
    },
    features: authenticatedProfilesTimelineFeatures,
  },
  userTweetsAndReplies: {
    variables: {
      userId: "1806359170830172162",
      count: 20,
      includePromotedContent: true,
      withCommunity: true,
      withVoice: true,
    },
    features: authenticatedProfilesTimelineFeatures,
    fieldToggles: {
      withArticlePlainText: false,
    },
  },
  likes: {
    variables: {
      userId: "2244196397",
      count: 20,
      includePromotedContent: false,
      withClientEventToken: false,
      withBirdwatchNotes: false,
      withVoice: true,
    },
    features: authenticatedProfilesTimelineFeatures,
    fieldToggles: {
      withArticlePlainText: false,
    },
  },
  followers: {
    variables: {
      userId: "1806359170830172162",
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    },
    features: authenticatedProfilesTimelineFeatures,
  },
  following: {
    variables: {
      userId: "1806359170830172162",
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    },
    features: authenticatedProfilesTimelineFeatures,
  },
  homeTimeline: {
    variables: {
      count: 20,
      includePromotedContent: true,
      latestControlAvailable: true,
      requestContext: "launch",
      withCommunity: true,
    },
    features: authenticatedProfilesTimelineFeatures,
    fieldToggles: {
      withArticlePlainText: false,
    },
  },
  tweetResultByRestId: {
    variables: {
      tweetId: "1985465713096794294",
      includePromotedContent: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withCommunity: true,
    },
    features: authenticatedProfilesTimelineFeatures,
    fieldToggles: {
      withArticleRichContentState: true,
      withArticlePlainText: false,
    },
  },
  tweetDetail: {
    variables: {
      focalTweetId: "1985465713096794294",
      with_rux_injections: false,
      rankingMode: "Relevance",
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
    },
    features: authenticatedProfilesTimelineFeatures,
    fieldToggles: {
      withArticleRichContentState: true,
      withArticlePlainText: false,
      withDisallowedReplyControls: false,
      withGrokAnalyze: false,
    },
  },
} satisfies Readonly<Record<string, EndpointTemplate>>;

const normalizeForJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeForJson(entryValue)]),
    );
  }

  return value;
};

const stableJson = (value: unknown) => JSON.stringify(normalizeForJson(value));

const relationshipCount = (count: number) => Math.min(count, 50);
const listTweetsCount = (count: number) => Math.min(count, 200);
const searchCount = (count: number) => Math.min(count, 50);
const tweetsAndRepliesCount = (count: number) => Math.min(count, 40);
const likedTweetsCount = (count: number) => Math.min(count, 200);

const buildTrendsUrl = () => {
  const params = new URLSearchParams();

  params.set("include_profile_interstitial_type", "1");
  params.set("include_blocking", "1");
  params.set("include_blocked_by", "1");
  params.set("include_followed_by", "1");
  params.set("include_want_retweets", "1");
  params.set("include_mute_edge", "1");
  params.set("include_can_dm", "1");
  params.set("include_can_media_tag", "1");
  params.set("include_ext_has_nft_avatar", "1");
  params.set("include_ext_is_blue_verified", "1");
  params.set("include_ext_verified_type", "1");
  params.set("skip_status", "1");
  params.set("cards_platform", "Web-12");
  params.set("include_cards", "1");
  params.set("include_ext_alt_text", "true");
  params.set("include_ext_limited_action_results", "false");
  params.set("include_quote_count", "true");
  params.set("include_reply_count", "1");
  params.set("tweet_mode", "extended");
  params.set("include_ext_collab_control", "true");
  params.set("include_ext_views", "true");
  params.set("include_entities", "true");
  params.set("include_user_entities", "true");
  params.set("include_ext_media_color", "true");
  params.set("include_ext_media_availability", "true");
  params.set("include_ext_sensitive_media_warning", "true");
  params.set("include_ext_trusted_friends_metadata", "true");
  params.set("send_error_codes", "true");
  params.set("simple_quoted_tweet", "true");
  params.set("include_tweet_replies", "false");
  params.set("count", "20");
  params.set("candidate_source", "trends");
  params.set("include_page_configuration", "false");
  params.set("entity_tokens", "false");

  return `https://api.x.com/2/guide.json?${params.toString()}`;
};

// ---------------------------------------------------------------------------
// DM URL builders (REST 1.1 API)
// ---------------------------------------------------------------------------

const addDmBaseParams = (params: URLSearchParams) => {
  params.set("include_profile_interstitial_type", "1");
  params.set("include_blocking", "1");
  params.set("include_blocked_by", "1");
  params.set("include_followed_by", "1");
  params.set("include_want_retweets", "1");
  params.set("include_mute_edge", "1");
  params.set("include_can_dm", "1");
  params.set("include_can_media_tag", "1");
  params.set("include_ext_has_nft_avatar", "1");
  params.set("include_ext_is_blue_verified", "1");
  params.set("include_ext_verified_type", "1");
  params.set("skip_status", "1");
  params.set("cards_platform", "Web-12");
  params.set("include_cards", "1");
  params.set("include_ext_alt_text", "true");
  params.set("include_ext_limited_action_results", "false");
  params.set("include_quote_count", "true");
  params.set("include_reply_count", "1");
  params.set("tweet_mode", "extended");
  params.set("include_ext_collab_control", "true");
  params.set("include_ext_views", "true");
  params.set("include_entities", "true");
  params.set("include_user_entities", "true");
  params.set("include_ext_media_color", "true");
  params.set("include_ext_media_availability", "true");
  params.set("include_ext_sensitive_media_warning", "true");
  params.set("include_ext_trusted_friends_metadata", "true");
  params.set("send_error_codes", "true");
  params.set("simple_quoted_tweet", "true");
  params.set("include_tweet_replies", "false");
};

const buildDmInboxUrl = () => {
  const params = new URLSearchParams();
  addDmBaseParams(params);

  params.set("nsfw_filtering_enabled", "false");
  params.set("filter_low_quality", "true");
  params.set("include_quality", "all");
  params.set("include_ext_profile_image_shape", "1");
  params.set("dm_secret_conversations_enabled", "false");
  params.set("krs_registration_enabled", "false");
  params.set("include_ext_limited_action_results", "true");
  params.set("dm_users", "true");
  params.set("include_groups", "true");
  params.set("include_inbox_timelines", "true");
  params.set("supports_reactions", "true");
  params.set("supports_edit", "true");
  params.set("include_ext_edit_control", "true");
  params.set("include_ext_business_affiliations_label", "true");
  params.set("include_ext_parody_commentary_fan_label", "true");
  params.set(
    "ext",
    "mediaColor,altText,mediaStats,highlightedLabel,parodyCommentaryFanLabel,voiceInfo,birdwatchPivot,superFollowMetadata,unmentionInfo,editControl,article",
  );

  return `https://api.x.com/1.1/dm/inbox_initial_state.json?${params.toString()}`;
};

const buildDmConversationUrl = (conversationId: string, maxId?: string) => {
  const params = new URLSearchParams();
  addDmBaseParams(params);

  params.set("context", "FETCH_DM_CONVERSATION_HISTORY");
  params.set("include_ext_profile_image_shape", "1");
  params.set("dm_secret_conversations_enabled", "false");
  params.set("krs_registration_enabled", "false");
  params.set("include_ext_limited_action_results", "true");
  params.set("dm_users", "true");
  params.set("include_groups", "true");
  params.set("include_inbox_timelines", "true");
  params.set("supports_reactions", "true");
  params.set("supports_edit", "true");
  params.set("include_conversation_info", "true");
  params.set(
    "ext",
    "mediaColor,altText,mediaStats,highlightedLabel,parodyCommentaryFanLabel,voiceInfo,birdwatchPivot,superFollowMetadata,unmentionInfo,editControl,article",
  );

  if (maxId) {
    params.set("max_id", maxId);
  }

  return `https://api.x.com/1.1/dm/conversation/${conversationId}.json?${params.toString()}`;
};

const searchProductForMode = (mode: TweetSearchMode) => {
  switch (mode) {
    case "latest":
      return "Latest";
    case "photos":
      return "Photos";
    case "videos":
      return "Videos";
    case "top":
    default:
      return "Top";
  }
};

const buildUrl = (
  operationName: string,
  template: EndpointTemplate,
  overrides: {
    readonly fieldToggles?: Record<string, unknown>;
    readonly features?: Record<string, unknown>;
    readonly variables?: Record<string, unknown>;
  } = {},
) => {
  const params = new URLSearchParams();

  const variables = overrides.variables ?? template.variables;
  const features = overrides.features ?? template.features;
  const fieldToggles = overrides.fieldToggles ?? template.fieldToggles;

  if (variables) {
    params.set("variables", stableJson(variables));
  }

  if (features) {
    params.set("features", stableJson(features));
  }

  if (fieldToggles) {
    params.set("fieldToggles", stableJson(fieldToggles));
  }

  return `${graphqlBaseUrl(operationName)}?${params.toString()}`;
};

export const endpointRegistry = {
  guestActivate(url: string): ApiRequest<unknown> {
    return {
      endpointId: "GuestActivate",
      family: "activation",
      authRequirement: "guest",
      bearerToken: "default",
      rateLimitBucket: "guestActivation",
      method: "POST",
      url,
      body: {
        _tag: "form",
        value: {},
      },
      responseKind: "json",
      decode: (body) => body,
    };
  },

  userByScreenName(username: string): ApiRequest<Profile> {
    return {
      endpointId: "UserByScreenName",
      family: "graphql",
      authRequirement: "guest",
      bearerToken: "secondary",
      rateLimitBucket: "profileLookup",
      method: "GET",
      url: buildUrl("UserByScreenName", endpointTemplates.userByScreenName, {
        variables: {
          ...endpointTemplates.userByScreenName.variables,
          screen_name: username,
        },
      }),
      responseKind: "json",
      decode: (body) => parseProfileResponse(body, username),
    };
  },

  userTweets(
    userId: string,
    count: number,
    includePromotedContent: boolean,
    cursor?: string,
  ): ApiRequest<TimelinePage<Tweet>> {
    return {
      endpointId: "UserTweets",
      family: "graphql",
      authRequirement: "guest",
      bearerToken: "secondary",
      rateLimitBucket: "userTweets",
      method: "GET",
      url: buildUrl("UserTweets", endpointTemplates.userTweets, {
        variables: {
          ...endpointTemplates.userTweets.variables,
          userId,
          count,
          includePromotedContent,
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseTimelinePageResponse,
    };
  },

  listTweets(
    listId: string,
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Tweet>> {
    return {
      endpointId: "ListTweets",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "listTweets",
      method: "GET",
      url: buildUrl("ListLatestTweetsTimeline", endpointTemplates.listTweets, {
        variables: {
          ...endpointTemplates.listTweets.variables,
          listId,
          count: listTweetsCount(count),
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseListTweetsPageResponse,
    };
  },

  searchProfiles(
    query: string,
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Profile>> {
    return {
      endpointId: "SearchProfiles",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "searchProfiles",
      method: "GET",
      url: buildUrl("SearchTimeline", endpointTemplates.searchTimeline, {
        variables: {
          ...endpointTemplates.searchTimeline.variables,
          rawQuery: query,
          count: searchCount(count),
          product: "People",
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseSearchProfilesResponse,
    };
  },

  searchTweets(
    query: string,
    count: number,
    mode: TweetSearchMode,
    cursor?: string,
  ): ApiRequest<TimelinePage<Tweet>> {
    return {
      endpointId: "SearchTweets",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "searchTweets",
      method: "GET",
      url: buildUrl("SearchTimeline", endpointTemplates.searchTimeline, {
        variables: {
          ...endpointTemplates.searchTimeline.variables,
          rawQuery: query,
          count: searchCount(count),
          product: searchProductForMode(mode),
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseSearchTweetsResponse,
    };
  },

  followers(
    userId: string,
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Profile>> {
    return {
      endpointId: "Followers",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "followers",
      method: "GET",
      url: buildUrl("Followers", endpointTemplates.followers, {
        variables: {
          ...endpointTemplates.followers.variables,
          userId,
          count: relationshipCount(count),
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseFollowersPageResponse,
    };
  },

  following(
    userId: string,
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Profile>> {
    return {
      endpointId: "Following",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "following",
      method: "GET",
      url: buildUrl("Following", endpointTemplates.following, {
        variables: {
          ...endpointTemplates.following.variables,
          userId,
          count: relationshipCount(count),
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseFollowingPageResponse,
    };
  },

  userTweetsAndReplies(
    userId: string,
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Tweet>> {
    return {
      endpointId: "UserTweetsAndReplies",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "tweetsAndReplies",
      method: "GET",
      url: buildUrl("UserTweetsAndReplies", endpointTemplates.userTweetsAndReplies, {
        variables: {
          ...endpointTemplates.userTweetsAndReplies.variables,
          userId,
          count: tweetsAndRepliesCount(count),
          includePromotedContent: false,
          cursor,
        },
        fieldToggles: endpointTemplates.userTweetsAndReplies.fieldToggles,
      }),
      responseKind: "json",
      decode: parseTweetsAndRepliesPageResponse,
    };
  },

  likedTweets(
    userId: string,
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Tweet>> {
    return {
      endpointId: "Likes",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "likedTweets",
      method: "GET",
      url: buildUrl("Likes", endpointTemplates.likes, {
        variables: {
          ...endpointTemplates.likes.variables,
          userId,
          count: likedTweetsCount(count),
          cursor,
        },
        fieldToggles: endpointTemplates.likes.fieldToggles,
      }),
      responseKind: "json",
      decode: parseLikedTweetsPageResponse,
    };
  },

  homeTimeline(
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Tweet>> {
    return {
      endpointId: "HomeTimeline",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "homeTimeline",
      method: "GET",
      url: buildUrl("HomeTimeline", endpointTemplates.homeTimeline, {
        variables: {
          ...endpointTemplates.homeTimeline.variables,
          count,
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseHomeTimelineResponse,
    };
  },

  tweetResultByRestId(id: string): ApiRequest<Tweet> {
    return {
      endpointId: "TweetResultByRestId",
      family: "graphql",
      authRequirement: "guest",
      bearerToken: "secondary",
      rateLimitBucket: "tweetResultByRestId",
      method: "GET",
      url: buildUrl("TweetResultByRestId", endpointTemplates.tweetResultByRestId, {
        variables: {
          ...endpointTemplates.tweetResultByRestId.variables,
          tweetId: id,
        },
      }),
      responseKind: "json",
      decode: (body) => parseTweetResultByRestIdResponse(body, id),
    };
  },

  tweetDetail(id: string): ApiRequest<TweetDetailDocument> {
    return {
      endpointId: "TweetDetail",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "tweetDetail",
      method: "GET",
      url: buildUrl("TweetDetail", endpointTemplates.tweetDetail, {
        variables: {
          ...endpointTemplates.tweetDetail.variables,
          focalTweetId: id,
        },
      }),
      responseKind: "json",
      decode: (body) => parseTweetDetailResponse(body, id),
    };
  },

  trends(): ApiRequest<readonly string[]> {
    return {
      endpointId: "Trends",
      family: "rest",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "trends",
      method: "GET",
      url: buildTrendsUrl(),
      responseKind: "json",
      decode: parseTrendsResponse,
    };
  },

  dmInbox(): ApiRequest<DmInbox> {
    return {
      endpointId: "DmInbox",
      family: "rest",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "dmInbox",
      method: "GET",
      url: buildDmInboxUrl(),
      responseKind: "json",
      decode: parseDmInboxResponse,
    };
  },

  dmConversation(
    conversationId: string,
    maxId?: string,
  ): ApiRequest<DmConversationPage> {
    return {
      endpointId: "DmConversation",
      family: "rest",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "dmConversation",
      method: "GET",
      url: buildDmConversationUrl(conversationId, maxId),
      responseKind: "json",
      decode: (body) => parseDmConversationResponse(body, conversationId),
    };
  },
} as const;
