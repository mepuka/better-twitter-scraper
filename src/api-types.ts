export interface UrlEntityRaw {
  readonly expanded_url?: string;
  readonly url?: string;
}

export interface MentionRaw {
  readonly id_str?: string;
  readonly name?: string;
  readonly screen_name?: string;
}

export interface TimelineMediaExtendedRaw {
  readonly ext_alt_text?: string;
  readonly ext_sensitive_media_warning?: {
    readonly adult_content?: boolean;
    readonly graphic_violence?: boolean;
    readonly other?: boolean;
  };
  readonly id_str?: string;
  readonly media_url_https?: string;
  readonly type?: string;
  readonly url?: string;
  readonly video_info?: {
    readonly variants?: ReadonlyArray<{
      readonly bitrate?: number;
      readonly content_type?: string;
      readonly url?: string;
    }>;
  };
}

export interface LegacyTweetRaw {
  readonly bookmark_count?: number;
  readonly conversation_id_str?: string;
  readonly created_at?: string;
  readonly entities?: {
    readonly hashtags?: ReadonlyArray<{ readonly text?: string }>;
    readonly urls?: ReadonlyArray<UrlEntityRaw>;
    readonly user_mentions?: ReadonlyArray<MentionRaw>;
  };
  readonly extended_entities?: {
    readonly media?: ReadonlyArray<TimelineMediaExtendedRaw>;
  };
  readonly ext_views?: {
    readonly count?: string;
  };
  readonly favorite_count?: number;
  readonly full_text?: string;
  readonly id_str?: string;
  readonly in_reply_to_status_id_str?: string;
  readonly place?: {
    readonly bounding_box?: {
      readonly coordinates?: number[][][];
      readonly type?: string;
    };
    readonly country?: string;
    readonly country_code?: string;
    readonly full_name?: string;
    readonly id?: string;
    readonly name?: string;
    readonly place_type?: string;
  };
  readonly quoted_status_id_str?: string;
  readonly reply_count?: number;
  readonly retweet_count?: number;
  readonly retweeted_status_id_str?: string;
  readonly retweeted_status_result?: {
    readonly result?: TimelineResultRaw;
  };
  readonly user_id_str?: string;
}

/** Merged CoreUserRaw: builder's name/screen_name + parsers' created_at */
export interface CoreUserRaw {
  readonly created_at?: string;
  readonly name?: string;
  readonly screen_name?: string;
}

/** Slim user embedded in tweet results (not the full profile version) */
export interface LegacyTweetUserRaw {
  readonly name?: string;
  readonly pinned_tweet_ids_str?: ReadonlyArray<string>;
  readonly screen_name?: string;
}

export interface TimelineResultRaw {
  readonly __typename?: string;
  readonly core?: {
    readonly user_results?: {
      readonly result?: {
        readonly core?: CoreUserRaw;
        readonly legacy?: LegacyTweetUserRaw;
      };
    };
  };
  readonly edit_control?: {
    readonly edit_control_initial?: {
      readonly edit_tweet_ids?: ReadonlyArray<string>;
    };
  };
  readonly legacy?: LegacyTweetRaw;
  readonly note_tweet?: {
    readonly note_tweet_results?: {
      readonly result?: {
        readonly text?: string;
      };
    };
  };
  readonly quoted_status_result?: {
    readonly result?: TimelineResultRaw;
  };
  readonly rest_id?: string;
  readonly tweet?: TimelineResultRaw;
  readonly views?: {
    readonly count?: string;
  };
}

export interface TimelineEntryItemContentRaw {
  readonly tweet_results?: {
    readonly result?: TimelineResultRaw;
  };
  readonly tweetDisplayType?: string;
  readonly tweetResult?: {
    readonly result?: TimelineResultRaw;
  };
}

export interface TimelineEntryRaw {
  readonly content?: {
    readonly cursorType?: string;
    readonly itemContent?: TimelineEntryItemContentRaw;
    readonly items?: ReadonlyArray<{
      readonly item?: {
        readonly content?: TimelineEntryItemContentRaw;
        readonly itemContent?: TimelineEntryItemContentRaw;
      };
    }>;
    readonly value?: string;
  };
  readonly entryId: string;
}

export interface TimelineInstructionRaw {
  readonly entries?: ReadonlyArray<TimelineEntryRaw>;
  readonly entry?: TimelineEntryRaw;
}
