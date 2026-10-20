import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import eventsAttach from "./events-attach.ts";
import type eventsTypesModule from "./events-types.ts";
import type typesModule from "./types.types.ts";
import view from "./view.ts";

const { conversationViews } = view;
const { attachEvents } = eventsAttach;

const openStream = Effect.fnUntraced(function* (
  harness: typesModule.Harness,
  conversationId: typesModule.ConversationId,
  context: Context,
) {
  const views = conversationViews(harness);
  const { snapshot, watch } = yield* attachEvents(views, conversationId, context);
  const signal = context.abortSignal;
  if (signal?.aborted === true) {
    watch.cancel();
    return yield* Effect.die(signal.reason);
  }
  if (signal !== undefined) watch.observeCancellation(signal);
  return {
    closed: watch.closed,
    snapshot,
    start: (listener: Parameters<eventsTypesModule.AgentEventStream["start"]>[0]) =>
      watch.start((events, _ops, deliveryContext) => listener(events, deliveryContext)),
    stop: () => watch.stop(),
  } satisfies eventsTypesModule.AgentEventStream;
});

const watchEvents: typesModule.Dual3<
  typesModule.Harness,
  typesModule.ConversationId,
  Context,
  Promise<eventsTypesModule.AgentEventStream>
> = Function.dual(
  3,
  (harness: typesModule.Harness, conversationId: typesModule.ConversationId, context: Context) =>
    Effect.runPromise(openStream(harness, conversationId, context)),
);

const eventsModule = {
  watchEvents,
};

export default eventsModule;
