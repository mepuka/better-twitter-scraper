export interface Mention {
  readonly id: string;
  readonly username?: string;
  readonly name?: string;
}

export interface Profile {
  readonly avatar?: string;
  readonly banner?: string;
  readonly biography?: string;
  readonly followersCount?: number;
  readonly followingCount?: number;
  readonly mediaCount?: number;
  readonly tweetsCount?: number;
  readonly isPrivate?: boolean;
  readonly isVerified?: boolean;
  readonly isBlueVerified?: boolean;
  readonly joined?: Date;
  readonly likesCount?: number;
  readonly listedCount?: number;
  readonly location?: string;
  readonly name?: string;
  readonly pinnedTweetIds?: readonly string[];
  readonly url?: string;
  readonly userId?: string;
  readonly username?: string;
  readonly website?: string;
  readonly canDm?: boolean;
}

export interface Tweet {
  readonly id: string;
  readonly conversationId?: string;
  readonly hashtags: readonly string[];
  readonly mentions: readonly Mention[];
  readonly name?: string;
  readonly permanentUrl?: string;
  readonly text?: string;
  readonly timestamp?: number;
  readonly timeParsed?: Date;
  readonly urls: readonly string[];
  readonly userId?: string;
  readonly username?: string;
  readonly views?: number;
  readonly likes?: number;
  readonly replies?: number;
  readonly retweets?: number;
  readonly isQuoted: boolean;
  readonly isReply: boolean;
  readonly isRetweet: boolean;
  readonly quotedTweetId?: string;
  readonly inReplyToTweetId?: string;
  readonly retweetedTweetId?: string;
}

export type TimelineStatus = "has_more" | "at_end";

export interface TimelinePage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly previousCursor?: string;
  readonly status: TimelineStatus;
}

export interface GetTweetsOptions {
  readonly limit?: number;
}

export interface GetProfilesOptions {
  readonly limit?: number;
}

export type TweetSearchMode = "top" | "latest" | "photos" | "videos";

export interface SearchTweetsOptions {
  readonly limit?: number;
  readonly mode?: TweetSearchMode;
}
