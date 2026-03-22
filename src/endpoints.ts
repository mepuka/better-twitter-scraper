import type { Profile, TimelinePage, Tweet } from "./models";
import { parseProfileResponse, parseTimelinePageResponse } from "./parsers";
import type { ApiRequest } from "./request";

interface EndpointTemplate {
  readonly url: string;
  readonly variables?: Record<string, unknown>;
  readonly features?: Record<string, unknown>;
  readonly fieldToggles?: Record<string, unknown>;
}

const USER_BY_SCREEN_NAME_EXAMPLE =
  "https://api.x.com/graphql/AWbeRIdkLtqTRN7yL_H8yw/UserByScreenName?variables=%7B%22screen_name%22%3A%22elonmusk%22%2C%22withGrokTranslatedBio%22%3Atrue%7D&features=%7B%22hidden_profile_subscriptions_enabled%22%3Atrue%2C%22profile_label_improvements_pcf_label_in_post_enabled%22%3Atrue%2C%22responsive_web_profile_redirect_enabled%22%3Afalse%2C%22rweb_tipjar_consumption_enabled%22%3Afalse%2C%22verified_phone_label_enabled%22%3Afalse%2C%22subscriptions_verification_info_is_identity_verified_enabled%22%3Atrue%2C%22subscriptions_verification_info_verified_since_enabled%22%3Atrue%2C%22highlights_tweets_tab_ui_enabled%22%3Atrue%2C%22responsive_web_twitter_article_notes_tab_enabled%22%3Atrue%2C%22subscriptions_feature_can_gift_premium%22%3Atrue%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%7D&fieldToggles=%7B%22withPayments%22%3Afalse%2C%22withAuxiliaryUserLabels%22%3Atrue%7D";

const USER_TWEETS_EXAMPLE =
  "https://api.x.com/graphql/N2tFDY-MlrLxXJ9F_ZxJGA/UserTweets?variables=%7B%22userId%22%3A%2244196397%22%2C%22count%22%3A20%2C%22includePromotedContent%22%3Atrue%2C%22withQuickPromoteEligibilityTweetFields%22%3Atrue%2C%22withVoice%22%3Atrue%7D&features=%7B%22rweb_video_screen_enabled%22%3Afalse%2C%22profile_label_improvements_pcf_label_in_post_enabled%22%3Atrue%2C%22responsive_web_profile_redirect_enabled%22%3Afalse%2C%22rweb_tipjar_consumption_enabled%22%3Afalse%2C%22verified_phone_label_enabled%22%3Afalse%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22premium_content_api_read_enabled%22%3Afalse%2C%22communities_web_enable_tweet_community_results_fetch%22%3Atrue%2C%22c9s_tweet_anatomy_moderator_badge_enabled%22%3Atrue%2C%22responsive_web_grok_analyze_button_fetch_trends_enabled%22%3Afalse%2C%22responsive_web_grok_analyze_post_followups_enabled%22%3Atrue%2C%22responsive_web_jetfuel_frame%22%3Atrue%2C%22responsive_web_grok_share_attachment_enabled%22%3Atrue%2C%22responsive_web_grok_annotations_enabled%22%3Atrue%2C%22articles_preview_enabled%22%3Atrue%2C%22responsive_web_edit_tweet_api_enabled%22%3Atrue%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Atrue%2C%22view_counts_everywhere_api_enabled%22%3Atrue%2C%22longform_notetweets_consumption_enabled%22%3Atrue%2C%22responsive_web_twitter_article_tweet_consumption_enabled%22%3Atrue%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22responsive_web_grok_show_grok_translated_post%22%3Atrue%2C%22responsive_web_grok_analysis_button_from_backend%22%3Atrue%2C%22post_ctas_fetch_enabled%22%3Atrue%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Atrue%2C%22standardized_nudges_misinfo%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Atrue%2C%22longform_notetweets_rich_text_read_enabled%22%3Atrue%2C%22longform_notetweets_inline_media_enabled%22%3Atrue%2C%22responsive_web_grok_image_annotation_enabled%22%3Atrue%2C%22responsive_web_grok_imagine_annotation_enabled%22%3Atrue%2C%22responsive_web_grok_community_note_auto_translation_is_enabled%22%3Afalse%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%7D&fieldToggles=%7B%22withArticlePlainText%22%3Afalse%7D";

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

const parseEndpointTemplate = (exampleUrl: string): EndpointTemplate => {
  const { protocol, host, pathname, searchParams } = new URL(exampleUrl);
  return {
    url: `${protocol}//${host}${pathname}`,
    variables: searchParams.get("variables")
      ? JSON.parse(searchParams.get("variables")!)
      : undefined,
    features: searchParams.get("features")
      ? JSON.parse(searchParams.get("features")!)
      : undefined,
    fieldToggles: searchParams.get("fieldToggles")
      ? JSON.parse(searchParams.get("fieldToggles")!)
      : undefined,
  };
};

const buildUrl = (
  template: EndpointTemplate,
  overrides: {
    readonly variables?: Record<string, unknown>;
    readonly features?: Record<string, unknown>;
    readonly fieldToggles?: Record<string, unknown>;
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

const userByScreenNameTemplate = parseEndpointTemplate(USER_BY_SCREEN_NAME_EXAMPLE);
const userTweetsTemplate = parseEndpointTemplate(USER_TWEETS_EXAMPLE);

export const endpointRegistry = {
  userByScreenName(username: string): ApiRequest<Profile> {
    return {
      endpointId: "UserByScreenName",
      family: "graphql",
      authRequirement: "guest",
      bearerToken: "secondary",
      rateLimitBucket: "profileLookup",
      method: "GET",
      url: buildUrl(userByScreenNameTemplate, {
        variables: {
          ...userByScreenNameTemplate.variables,
          screen_name: username,
        },
      }),
      decode: (body) => parseProfileResponse(body, username),
    };
  },

  userTweets(
    userId: string,
    count: number,
    cursor?: string,
  ): ApiRequest<TimelinePage<Tweet>> {
    return {
      endpointId: "UserTweets",
      family: "graphql",
      authRequirement: "guest",
      bearerToken: "secondary",
      rateLimitBucket: "userTweets",
      method: "GET",
      url: buildUrl(userTweetsTemplate, {
        variables: {
          ...userTweetsTemplate.variables,
          userId,
          count,
          includePromotedContent: false,
          cursor,
        },
      }),
      decode: parseTimelinePageResponse,
    };
  },
} as const;
