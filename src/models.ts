import { Brand, Schema } from "effect";
import { TweetPhoto, TweetPlace, TweetVideo } from "./tweet-detail-model";

export type UserId = string & Brand.Brand<"UserId">;
export const UserId = Brand.nominal<UserId>();

export type TweetId = string & Brand.Brand<"TweetId">;
export const TweetId = Brand.nominal<TweetId>();

export type ListId = string & Brand.Brand<"ListId">;
export const ListId = Brand.nominal<ListId>();

export type Username = string & Brand.Brand<"Username">;
export const Username = Brand.nominal<Username>();

export class Mention extends Schema.Class<Mention>("Mention")({
  id: Schema.String,
  username: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
}) {}

export class Profile extends Schema.Class<Profile>("Profile")({
  avatar: Schema.optionalKey(Schema.String),
  banner: Schema.optionalKey(Schema.String),
  biography: Schema.optionalKey(Schema.String),
  followersCount: Schema.optionalKey(Schema.Number),
  followingCount: Schema.optionalKey(Schema.Number),
  mediaCount: Schema.optionalKey(Schema.Number),
  tweetsCount: Schema.optionalKey(Schema.Number),
  isPrivate: Schema.optionalKey(Schema.Boolean),
  isVerified: Schema.optionalKey(Schema.Boolean),
  isBlueVerified: Schema.optionalKey(Schema.Boolean),
  joined: Schema.optionalKey(Schema.Date),
  likesCount: Schema.optionalKey(Schema.Number),
  listedCount: Schema.optionalKey(Schema.Number),
  location: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  pinnedTweetIds: Schema.optionalKey(Schema.Array(Schema.String)),
  url: Schema.optionalKey(Schema.String),
  userId: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String),
  website: Schema.optionalKey(Schema.String),
  canDm: Schema.optionalKey(Schema.Boolean),
}) {}

export class Tweet extends Schema.Class<Tweet>("Tweet")({
  id: Schema.String,
  conversationId: Schema.optionalKey(Schema.String),
  hashtags: Schema.Array(Schema.String),
  mentions: Schema.Array(Mention),
  name: Schema.optionalKey(Schema.String),
  permanentUrl: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.Number),
  timeParsed: Schema.optionalKey(Schema.Date),
  urls: Schema.Array(Schema.String),
  userId: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String),
  views: Schema.optionalKey(Schema.Number),
  likes: Schema.optionalKey(Schema.Number),
  replies: Schema.optionalKey(Schema.Number),
  retweets: Schema.optionalKey(Schema.Number),
  photos: Schema.Array(TweetPhoto),
  videos: Schema.Array(TweetVideo),
  sensitiveContent: Schema.optionalKey(Schema.Boolean),
  html: Schema.optionalKey(Schema.String),
  bookmarkCount: Schema.optionalKey(Schema.Number),
  isEdited: Schema.optionalKey(Schema.Boolean),
  isSelfThread: Schema.optionalKey(Schema.Boolean),
  isPinned: Schema.optionalKey(Schema.Boolean),
  isPromoted: Schema.optionalKey(Schema.Boolean),
  isQuoted: Schema.Boolean,
  isReply: Schema.Boolean,
  isRetweet: Schema.Boolean,
  quotedTweetId: Schema.optionalKey(Schema.String),
  inReplyToTweetId: Schema.optionalKey(Schema.String),
  retweetedTweetId: Schema.optionalKey(Schema.String),
  quotedTweet: Schema.optionalKey(Schema.suspend((): Schema.Schema<Tweet> => Tweet)),
  retweetedTweet: Schema.optionalKey(Schema.suspend((): Schema.Schema<Tweet> => Tweet)),
  place: Schema.optionalKey(TweetPlace),
}) {}

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
