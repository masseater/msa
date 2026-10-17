import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { attachEvents } from "./events-attach.ts";
import type { AgentEventStream } from "./events-types.ts";
import type { ConversationId, Dual3, Harness } from "./types.ts";
import { conversationViews } from "./view.ts";

export type {
  AgentEvent,
  AgentEventStream,
  MessageChange,
  SnapshotEvent,
  ToolEventCall,
} from "./events-types.ts";

const openStream = Effect.fn("openAgentEventStream")(function* (
  harness: Harness,
  conversationId: ConversationId,
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
    snapshot,
    start: (listener: Parameters<AgentEventStream["start"]>[0]) =>
      watch.start((events, _ops, deliveryContext) => listener(events, deliveryContext)),
    stop: () => watch.stop(),
    closed: watch.closed,
  } satisfies AgentEventStream;
});

export const watchEvents: Dual3<
  Harness,
  ConversationId,
  Context,
  Promise<AgentEventStream>
> = Function.dual(3, (harness: Harness, conversationId: ConversationId, context: Context) =>
  Effect.runPromise(openStream(harness, conversationId, context)),
);
