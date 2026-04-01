import type { Profile, TimelinePage, Tweet, TweetSearchMode } from "./models";
import {
  parseFollowersPageResponse,
  parseFollowingPageResponse,
  parseProfileResponse,
  parseSearchProfilesResponse,
  parseSearchTweetsResponse,
  parseTweetDetailResponse,
  parseTrendsResponse,
  parseTweetsAndRepliesPageResponse,
  parseTimelinePageResponse,
  parseLikedTweetsPageResponse,
} from "./parsers";
import type { ApiRequest } from "./request";
import type { TweetDetailDocument } from "./tweet-detail-model";

interface EndpointTemplate {
  readonly url: string;
  readonly variables?: Record<string, unknown>;
  readonly features?: Record<string, unknown>;
  readonly fieldToggles?: Record<string, unknown>;
}

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
    url: "https://api.x.com/graphql/AWbeRIdkLtqTRN7yL_H8yw/UserByScreenName",
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
    url: "https://api.x.com/graphql/N2tFDY-MlrLxXJ9F_ZxJGA/UserTweets",
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
  searchTimeline: {
    url: "https://api.x.com/graphql/ML-n2SfAxx5S_9QMqNejbg/SearchTimeline",
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
    url: "https://api.x.com/graphql/2NDLUdBmT_IB5uGwZ3tHRg/UserTweetsAndReplies",
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
    url: "https://api.x.com/graphql/Pcw-j9lrSeDMmkgnIejJiQ/Likes",
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
    url: "https://api.x.com/graphql/P7m4Qr-rJEB8KUluOenU6A/Followers",
    variables: {
      userId: "1806359170830172162",
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    },
    features: authenticatedProfilesTimelineFeatures,
  },
  following: {
    url: "https://api.x.com/graphql/T5wihsMTYHncY7BB4YxHSg/Following",
    variables: {
      userId: "1806359170830172162",
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    },
    features: authenticatedProfilesTimelineFeatures,
  },
  tweetDetail: {
    url: "https://api.x.com/graphql/YCNdW_ZytXfV9YR3cJK9kw/TweetDetail",
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

  return `${template.url}?${params.toString()}`;
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
      url: buildUrl(endpointTemplates.userByScreenName, {
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
      url: buildUrl(endpointTemplates.userTweets, {
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
      url: buildUrl(endpointTemplates.searchTimeline, {
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
      url: buildUrl(endpointTemplates.searchTimeline, {
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
      url: buildUrl(endpointTemplates.followers, {
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
      url: buildUrl(endpointTemplates.following, {
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
      url: buildUrl(endpointTemplates.userTweetsAndReplies, {
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
      url: buildUrl(endpointTemplates.likes, {
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

  tweetDetail(id: string): ApiRequest<TweetDetailDocument> {
    return {
      endpointId: "TweetDetail",
      family: "graphql",
      authRequirement: "user",
      bearerToken: "secondary",
      rateLimitBucket: "tweetDetail",
      method: "GET",
      url: buildUrl(endpointTemplates.tweetDetail, {
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
} as const;
