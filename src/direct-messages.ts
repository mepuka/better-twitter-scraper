import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import type { DmConversationPage, DmInbox } from "./dm-models";
import { DmMessage } from "./dm-models";
import { endpointRegistry } from "./endpoints";
import { ScraperStrategy, type StrategyError } from "./strategy";

type DmError = StrategyError;

export class TwitterDirectMessages extends ServiceMap.Service<
  TwitterDirectMessages,
  {
    readonly getInbox: () => Effect.Effect<DmInbox, DmError>;
    readonly getConversation: (
      conversationId: string,
      options?: { limit?: number },
    ) => Stream.Stream<DmMessage, DmError>;
  }
>()("@better-twitter-scraper/TwitterDirectMessages") {
  static readonly layer = Layer.effect(
    TwitterDirectMessages,
    Effect.gen(function* () {
      const strategy = yield* ScraperStrategy;

      const getInbox = Effect.fn(
        "TwitterDirectMessages.getInbox",
      )(function* () {
        return yield* strategy.execute(endpointRegistry.dmInbox());
      });

      const fetchConversationPage = Effect.fn(
        "TwitterDirectMessages.fetchConversationPage",
      )((conversationId: string, maxId?: string) =>
        strategy.execute(
          endpointRegistry.dmConversation(conversationId, maxId),
        ),
      );

      interface PaginationState {
        readonly conversationId: string;
        readonly maxId: string | undefined;
        readonly remaining: number;
        readonly seenMaxIds: ReadonlySet<string>;
      }

      const getConversation = (
        conversationId: string,
        options: { limit?: number } = {},
      ): Stream.Stream<DmMessage, DmError> => {
        const remaining = options.limit ?? 50;

        return Stream.paginate<PaginationState, DmMessage, DmError>(
          {
            conversationId,
            maxId: undefined,
            remaining,
            seenMaxIds: new Set<string>(),
          },
          (state) => {
            if (state.remaining <= 0) {
              return Effect.succeed(
                [[], Option.none<PaginationState>()] as const,
              );
            }

            return Effect.gen(function* () {
              const page: DmConversationPage =
                yield* fetchConversationPage(
                  state.conversationId,
                  state.maxId,
                );

              const messages = page.messages.slice(0, state.remaining);
              const newRemaining = state.remaining - messages.length;
              const duplicateMaxId =
                page.minEntryId !== undefined &&
                state.seenMaxIds.has(page.minEntryId);

              const atEnd =
                messages.length === 0 ||
                page.status === "AT_END" ||
                !page.minEntryId ||
                duplicateMaxId;

              const next =
                atEnd || newRemaining <= 0
                  ? Option.none<PaginationState>()
                  : Option.some<PaginationState>({
                      conversationId: state.conversationId,
                      maxId: page.minEntryId,
                      remaining: newRemaining,
                      seenMaxIds: new Set(state.seenMaxIds).add(page.minEntryId),
                    });

              return [messages, next] as const;
            });
          },
        );
      };

      return { getInbox, getConversation };
    }),
  );
}
