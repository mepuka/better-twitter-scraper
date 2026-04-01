import * as Graph from "effect/Graph";
import * as Option from "effect/Option";

import type {
  TweetDetailDocument,
  TweetDetailNode,
  TweetRelationKind,
  TweetReplyTreeNode,
} from "./tweet-detail-model";

interface TweetDetailIndex {
  readonly graph: Graph.Graph<TweetDetailNode, TweetRelationKind>;
  readonly nodeById: ReadonlyMap<string, TweetDetailNode>;
  readonly nodeIndexById: ReadonlyMap<string, Graph.NodeIndex>;
  readonly orderById: ReadonlyMap<string, number>;
  readonly pairKinds: ReadonlyMap<string, ReadonlySet<TweetRelationKind>>;
}

const detailIndexCache = new WeakMap<TweetDetailDocument, TweetDetailIndex>();

const pairKey = (sourceTweetId: string, targetTweetId: string) =>
  `${sourceTweetId}\u0000${targetTweetId}`;

const compareByCanonicalOrder = (
  index: TweetDetailIndex,
  leftId: string,
  rightId: string,
) =>
  (index.orderById.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
    (index.orderById.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
  leftId.localeCompare(rightId);

const buildTweetDetailIndex = (
  document: TweetDetailDocument,
): TweetDetailIndex => {
  const nodeById = new Map<string, TweetDetailNode>();
  const nodeIndexById = new Map<string, Graph.NodeIndex>();
  const orderById = new Map<string, number>();
  const pairKinds = new Map<string, Set<TweetRelationKind>>();

  const graph = Graph.mutate(
    Graph.directed<TweetDetailNode, TweetRelationKind>(),
    (mutable) => {
      document.tweets.forEach((tweet, index) => {
        nodeById.set(tweet.id, tweet);
        orderById.set(tweet.id, index);
        nodeIndexById.set(tweet.id, Graph.addNode(mutable, tweet));
      });

      for (const relation of document.relations) {
        const sourceIndex = nodeIndexById.get(relation.sourceTweetId);
        const targetIndex = nodeIndexById.get(relation.targetTweetId);

        if (sourceIndex === undefined || targetIndex === undefined) {
          continue;
        }

        Graph.addEdge(mutable, sourceIndex, targetIndex, relation.kind);

        const key = pairKey(relation.sourceTweetId, relation.targetTweetId);
        const kinds = pairKinds.get(key);
        if (kinds) {
          kinds.add(relation.kind);
        } else {
          pairKinds.set(key, new Set([relation.kind]));
        }
      }
    },
  );

  return {
    graph,
    nodeById,
    nodeIndexById,
    orderById,
    pairKinds,
  };
};

const getIndex = (document: TweetDetailDocument): TweetDetailIndex => {
  const cached = detailIndexCache.get(document);
  if (cached) {
    return cached;
  }

  const index = buildTweetDetailIndex(document);
  detailIndexCache.set(document, index);
  return index;
};

const getNode = (
  document: TweetDetailDocument,
  tweetId: string,
): TweetDetailNode | undefined => getIndex(document).nodeById.get(tweetId);

const resolveTweetId = (
  document: TweetDetailDocument,
  tweetId?: string,
): string => tweetId ?? document.focalTweetId;

const orderedNodes = (
  document: TweetDetailDocument,
  tweetIds: Iterable<string>,
  options: {
    readonly fullOnly?: boolean;
  } = {},
): readonly TweetDetailNode[] => {
  const index = getIndex(document);

  return [...new Set(tweetIds)]
    .sort((left, right) => compareByCanonicalOrder(index, left, right))
    .flatMap((tweetId) => {
      const node = index.nodeById.get(tweetId);
      if (!node) {
        return [];
      }

      if (options.fullOnly && node.resolution !== "full") {
        return [];
      }

      return [node];
    });
};

const relatedTweetIds = (
  document: TweetDetailDocument,
  tweetId: string,
  direction: "incoming" | "outgoing",
  kind: TweetRelationKind,
): readonly string[] => {
  const index = getIndex(document);
  const nodeIndex = index.nodeIndexById.get(tweetId);

  if (nodeIndex === undefined) {
    return [];
  }

  const relatedIds = new Set<string>();

  for (const neighborIndex of Graph.neighborsDirected(
    index.graph,
    nodeIndex,
    direction,
  )) {
    const neighbor = Graph.getNode(index.graph, neighborIndex);
    if (Option.isNone(neighbor)) {
      continue;
    }

    const sourceTweetId =
      direction === "outgoing" ? tweetId : neighbor.value.id;
    const targetTweetId =
      direction === "outgoing" ? neighbor.value.id : tweetId;
    const kinds = index.pairKinds.get(pairKey(sourceTweetId, targetTweetId));

    if (kinds?.has(kind)) {
      relatedIds.add(neighbor.value.id);
    }
  }

  return [...relatedIds].sort((left, right) =>
    compareByCanonicalOrder(index, left, right),
  );
};

const relatedTweet = (
  document: TweetDetailDocument,
  tweetId: string,
  direction: "incoming" | "outgoing",
  kind: TweetRelationKind,
): TweetDetailNode | undefined =>
  orderedNodes(document, relatedTweetIds(document, tweetId, direction, kind))[0];

export const getFocalTweet = (
  document: TweetDetailDocument,
): TweetDetailNode | undefined => getNode(document, document.focalTweetId);

export const getParentTweet = (
  document: TweetDetailDocument,
  tweetId?: string,
): TweetDetailNode | undefined =>
  relatedTweet(document, resolveTweetId(document, tweetId), "outgoing", "reply_to");

export const getQuotedTweet = (
  document: TweetDetailDocument,
  tweetId?: string,
): TweetDetailNode | undefined =>
  relatedTweet(document, resolveTweetId(document, tweetId), "outgoing", "quotes");

export const getRetweetedTweet = (
  document: TweetDetailDocument,
  tweetId?: string,
): TweetDetailNode | undefined =>
  relatedTweet(document, resolveTweetId(document, tweetId), "outgoing", "retweets");

export const getSelfThread = (
  document: TweetDetailDocument,
  tweetId?: string,
): readonly TweetDetailNode[] => {
  const resolvedTweetId = resolveTweetId(document, tweetId);
  const anchor = getNode(document, resolvedTweetId);

  if (!anchor) {
    return [];
  }

  const rootTweetId =
    relatedTweetIds(document, resolvedTweetId, "outgoing", "thread_root")[0] ??
    resolvedTweetId;

  const members = orderedNodes(
    document,
    document.tweets.flatMap((tweet) =>
      tweet.id === rootTweetId ||
      relatedTweetIds(document, tweet.id, "outgoing", "thread_root").includes(
        rootTweetId,
      )
        ? [tweet.id]
        : [],
    ),
    { fullOnly: true },
  );

  if (members.length > 0) {
    return members;
  }

  return anchor.resolution === "full" ? [anchor] : [];
};

export const getDirectReplies = (
  document: TweetDetailDocument,
  tweetId?: string,
): readonly TweetDetailNode[] =>
  orderedNodes(
    document,
    relatedTweetIds(
      document,
      resolveTweetId(document, tweetId),
      "incoming",
      "reply_to",
    ),
    { fullOnly: true },
  );

const buildReplyTree = (
  document: TweetDetailDocument,
  tweetId: string,
  visited: ReadonlySet<string>,
): TweetReplyTreeNode | undefined => {
  const tweet = getNode(document, tweetId);

  if (!tweet || visited.has(tweetId)) {
    return undefined;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(tweetId);

  return {
    replies: getDirectReplies(document, tweetId).flatMap((reply) => {
      const subtree = buildReplyTree(document, reply.id, nextVisited);
      return subtree ? [subtree] : [];
    }),
    tweet,
  };
};

export const getReplyTree = (
  document: TweetDetailDocument,
  tweetId?: string,
): TweetReplyTreeNode | undefined =>
  buildReplyTree(document, resolveTweetId(document, tweetId), new Set());
