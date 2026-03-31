import type { Profile, TimelinePage, Tweet } from "./models";
import {
  parseProfileResponse,
  parseSearchProfilesResponse,
  parseTimelinePageResponse,
} from "./parsers";
import type { ApiRequest } from "./request";

interface EndpointTemplate {
  readonly url: string;
  readonly variables?: Record<string, unknown>;
  readonly features?: Record<string, unknown>;
  readonly fieldToggles?: Record<string, unknown>;
}

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
  searchProfiles: {
    url: "https://api.x.com/graphql/ML-n2SfAxx5S_9QMqNejbg/SearchTimeline",
    variables: {
      rawQuery: "twitter",
      count: 20,
      querySource: "typed_query",
      product: "Top",
      withGrokTranslatedBio: false,
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
      url: buildUrl(endpointTemplates.searchProfiles, {
        variables: {
          ...endpointTemplates.searchProfiles.variables,
          rawQuery: query,
          count,
          product: "People",
          cursor,
        },
      }),
      responseKind: "json",
      decode: parseSearchProfilesResponse,
    };
  },
} as const;
