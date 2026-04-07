import { Effect, Layer, Ref, ServiceMap } from "effect";

import type { ApiRequest, ApiRequestBody } from "./request";

const fallbackQueryIds = new Map<string, string>([
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
  ["CommunityTweetsTimeline", "BnowIPH1W7RDwY3EkUgneg"],
  ["Bookmarks", "v8WqjYtOA2VZXidz0tEZgQ"],
  ["BookmarkSearchTimeline", "v8WqjYtOA2VZXidz0tEZgQ"],
  ["DeleteBookmark", "Wlmlj2-xzyS1GN3a6cj-mQ"],
]);

const normalizeBookmarkQueryIds = (queryIds: ReadonlyMap<string, string>) => {
  const next = new Map(queryIds);
  const bookmarks = next.get("Bookmarks");
  const search = next.get("BookmarkSearchTimeline");

  if (bookmarks !== undefined && search !== undefined && bookmarks !== search) {
    next.set("Bookmarks", search);
  }

  return next as ReadonlyMap<string, string>;
};

export const getFallbackQueryIds = (): ReadonlyMap<string, string> =>
  new Map(fallbackQueryIds);

export const mergeKnownQueryIds = (
  current: ReadonlyMap<string, string>,
  discovered: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> => {
  const next = new Map(current);

  for (const [name, id] of discovered) {
    if (next.has(name)) {
      next.set(name, id);
    }
  }

  return normalizeBookmarkQueryIds(next);
};

const replaceGraphqlUrlQueryId = (
  urlString: string,
  operationName: string,
  queryId: string,
) => {
  const url = new URL(urlString);
  url.pathname = `/graphql/${queryId}/${operationName}`;
  return url.toString();
};

const replaceBodyQueryId = (
  body: ApiRequestBody | undefined,
  queryId: string,
): ApiRequestBody | undefined => {
  if (
    body?._tag !== "json" ||
    typeof body.value !== "object" ||
    body.value === null ||
    Array.isArray(body.value)
  ) {
    return body;
  }

  return {
    ...body,
    value: {
      ...body.value,
      queryId,
    },
  };
};

export const resolveRequestQueryIds = <A>(
  request: ApiRequest<A>,
  queryIds: ReadonlyMap<string, string>,
): ApiRequest<A> => {
  if (!request.graphqlOperationName) {
    return request;
  }

  const queryId = queryIds.get(request.graphqlOperationName);
  if (!queryId) {
    return request;
  }

  const body = request.queryIdInBody
    ? replaceBodyQueryId(request.body, queryId)
    : request.body;

  return {
    ...request,
    url: replaceGraphqlUrlQueryId(
      request.url,
      request.graphqlOperationName,
      queryId,
    ),
    ...(body !== undefined ? { body } : {}),
  };
};

export interface EndpointCatalogInstance {
  readonly resolveRequest: <A>(
    request: ApiRequest<A>,
  ) => Effect.Effect<ApiRequest<A>>;
  readonly snapshot: Effect.Effect<ReadonlyMap<string, string>>;
  readonly updateQueryIds: (
    discovered: ReadonlyMap<string, string>,
  ) => Effect.Effect<void>;
}

export class TwitterEndpointCatalog extends ServiceMap.Service<
  TwitterEndpointCatalog,
  EndpointCatalogInstance
>()("@better-twitter-scraper/TwitterEndpointCatalog") {
  static readonly liveLayer = Layer.effect(
    TwitterEndpointCatalog,
    Effect.gen(function* () {
      const queryIdsRef = yield* Ref.make(getFallbackQueryIds());

      const snapshot = Ref.get(queryIdsRef).pipe(
        Effect.map((queryIds) => new Map(queryIds) as ReadonlyMap<string, string>),
      );

      const resolveRequest = <A>(request: ApiRequest<A>) =>
        Ref.get(queryIdsRef).pipe(
          Effect.map((queryIds) => resolveRequestQueryIds(request, queryIds)),
        );

      const updateQueryIds = (discovered: ReadonlyMap<string, string>) =>
        Ref.update(
          queryIdsRef,
          (current) => mergeKnownQueryIds(current, discovered),
        ).pipe(Effect.asVoid);

      return {
        resolveRequest,
        snapshot,
        updateQueryIds,
      } satisfies EndpointCatalogInstance;
    }),
  );

  static testLayer(queryIds: ReadonlyMap<string, string> = getFallbackQueryIds()) {
    return Layer.effect(
      TwitterEndpointCatalog,
      Effect.gen(function* () {
        const queryIdsRef = yield* Ref.make(queryIds);

        const snapshot = Ref.get(queryIdsRef).pipe(
          Effect.map((current) => new Map(current) as ReadonlyMap<string, string>),
        );

        const resolveRequest = <A>(request: ApiRequest<A>) =>
          Ref.get(queryIdsRef).pipe(
            Effect.map((current) => resolveRequestQueryIds(request, current)),
          );

        const updateQueryIds = (discovered: ReadonlyMap<string, string>) =>
          Ref.update(
            queryIdsRef,
            (current) => mergeKnownQueryIds(current, discovered),
          ).pipe(Effect.asVoid);

        return {
          resolveRequest,
          snapshot,
          updateQueryIds,
        } satisfies EndpointCatalogInstance;
      }),
    );
  }
}
