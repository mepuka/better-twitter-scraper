import { Schema } from "effect";

const TweetMention = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String),
});

const TweetPlace = Schema.Struct({
  boundingBox: Schema.optionalKey(
    Schema.Struct({
      coordinates: Schema.optionalKey(
        Schema.Array(Schema.Array(Schema.Array(Schema.Number))),
      ),
      type: Schema.optionalKey(Schema.String),
    }),
  ),
  country: Schema.optionalKey(Schema.String),
  countryCode: Schema.optionalKey(Schema.String),
  fullName: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  placeType: Schema.optionalKey(Schema.String),
});

export class TweetPhoto extends Schema.Class<TweetPhoto>("TweetPhoto")({
  altText: Schema.optionalKey(Schema.String),
  id: Schema.String,
  url: Schema.String,
}) {}

export class TweetVideo extends Schema.Class<TweetVideo>("TweetVideo")({
  id: Schema.String,
  preview: Schema.String,
  url: Schema.optionalKey(Schema.String),
}) {}

export const TweetNodeResolution = Schema.Literals(["full", "reference"]);
export type TweetNodeResolution = typeof TweetNodeResolution.Type;

export const TweetRelationKind = Schema.Literals([
  "reply_to",
  "quotes",
  "retweets",
  "thread_root",
]);
export type TweetRelationKind = typeof TweetRelationKind.Type;

export class TweetRelation extends Schema.Class<TweetRelation>(
  "TweetRelation",
)({
  kind: TweetRelationKind,
  sourceTweetId: Schema.String,
  targetTweetId: Schema.String,
}) {}

export class TweetDetailNode extends Schema.Class<TweetDetailNode>(
  "TweetDetailNode",
)({
  bookmarkCount: Schema.optionalKey(Schema.Number),
  conversationId: Schema.optionalKey(Schema.String),
  hashtags: Schema.Array(Schema.String),
  html: Schema.optionalKey(Schema.String),
  id: Schema.String,
  isEdited: Schema.Boolean,
  isPin: Schema.Boolean,
  isQuoted: Schema.Boolean,
  isReply: Schema.Boolean,
  isRetweet: Schema.Boolean,
  isSelfThread: Schema.Boolean,
  likes: Schema.optionalKey(Schema.Number),
  mentions: Schema.Array(TweetMention),
  name: Schema.optionalKey(Schema.String),
  permanentUrl: Schema.optionalKey(Schema.String),
  photos: Schema.Array(TweetPhoto),
  place: Schema.optionalKey(TweetPlace),
  resolution: TweetNodeResolution,
  replies: Schema.optionalKey(Schema.Number),
  retweets: Schema.optionalKey(Schema.Number),
  sensitiveContent: Schema.Boolean,
  text: Schema.optionalKey(Schema.String),
  timeParsed: Schema.optionalKey(Schema.Date),
  timestamp: Schema.optionalKey(Schema.Number),
  urls: Schema.Array(Schema.String),
  userId: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String),
  versions: Schema.Array(Schema.String),
  videos: Schema.Array(TweetVideo),
  views: Schema.optionalKey(Schema.Number),
}) {}

export class TweetDetailDocument extends Schema.Class<TweetDetailDocument>(
  "TweetDetailDocument",
)({
  focalTweetId: Schema.String,
  relations: Schema.Array(TweetRelation),
  tweets: Schema.Array(TweetDetailNode),
}) {}

export interface TweetReplyTreeNode {
  readonly replies: ReadonlyArray<TweetReplyTreeNode>;
  readonly tweet: TweetDetailNode;
}

export const TweetReplyTreeNode: Schema.Schema<TweetReplyTreeNode> =
  Schema.Struct({
    replies: Schema.Array(
      Schema.suspend(
        (): Schema.Schema<TweetReplyTreeNode> => TweetReplyTreeNode,
      ),
    ),
    tweet: TweetDetailNode,
  });

export interface TweetConversationProjection {
  readonly conversationRoot: TweetDetailNode;
  readonly directReplies: ReadonlyArray<TweetDetailNode>;
  readonly parentTweet?: TweetDetailNode;
  readonly quotedTweet?: TweetDetailNode;
  readonly replyChain: ReadonlyArray<TweetDetailNode>;
  readonly replyTree?: TweetReplyTreeNode;
  readonly retweetedTweet?: TweetDetailNode;
  readonly selfThread: ReadonlyArray<TweetDetailNode>;
  readonly tweet: TweetDetailNode;
}

export const TweetConversationProjection: Schema.Schema<TweetConversationProjection> =
  Schema.Struct({
    conversationRoot: TweetDetailNode,
    directReplies: Schema.Array(TweetDetailNode),
    parentTweet: Schema.optionalKey(TweetDetailNode),
    quotedTweet: Schema.optionalKey(TweetDetailNode),
    replyChain: Schema.Array(TweetDetailNode),
    replyTree: Schema.optionalKey(TweetReplyTreeNode),
    retweetedTweet: Schema.optionalKey(TweetDetailNode),
    selfThread: Schema.Array(TweetDetailNode),
    tweet: TweetDetailNode,
  });
