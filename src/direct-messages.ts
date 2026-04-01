import { Effect, Layer, Option, ServiceMap, Stream } from "effect";

import type { DmConversationPage, DmInbox } from "./dm-models";
import { DmMessage } from "./dm-models";
import { endpointRegistry } from "./endpoints";
import { AuthenticationError } from "./errors";
import { ScraperStrategy, type StrategyError } from "./strategy";
import { UserAuth } from "./user-auth";

type DmError = AuthenticationError | StrategyError;

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
      const auth = yield* UserAuth;
      const strategy = yield* ScraperStrategy;

      const ensureLoggedIn = Effect.fn(
        "TwitterDirectMessages.ensureLoggedIn",
      )(function* () {
        const loggedIn = yield* auth.isLoggedIn();
        if (!loggedIn) {
          return yield* new AuthenticationError({
            reason:
              "Authenticated DM access requires restored session cookies.",
          });
        }
      });

      const getInbox = Effect.fn(
        "TwitterDirectMessages.getInbox",
      )(function* () {
        yield* ensureLoggedIn();
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
      }

      const getConversation = (
        conversationId: string,
        options: { limit?: number } = {},
      ): Stream.Stream<DmMessage, DmError> =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* ensureLoggedIn();

            const remaining = options.limit ?? 50;

            return Stream.paginate<PaginationState, DmMessage, DmError>(
              {
                conversationId,
                maxId: undefined,
                remaining,
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

                  const atEnd =
                    messages.length === 0 ||
                    page.status === "AT_END" ||
                    !page.minEntryId;

                  const next =
                    atEnd || newRemaining <= 0
                      ? Option.none<PaginationState>()
                      : Option.some<PaginationState>({
                          conversationId: state.conversationId,
                          maxId: page.minEntryId,
                          remaining: newRemaining,
                        });

                  return [messages, next] as const;
                });
              },
            );
          }),
        );

      return { getInbox, getConversation };
    }),
  );
}
