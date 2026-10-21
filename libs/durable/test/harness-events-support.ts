import type aiTypes from "@msa/ai/index.types";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import type harnessEventsSupportTypes from "./harness-events-support.types.ts";
import sessionSupport from "./session-support.ts";

const { watchEvents } = harnessModule;

const { awaited } = effectSupport;
const { context } = sessionSupport;

const listen = Effect.fn("listen")(function* (
  harness: durableTypes.Harness,
  conversation: durableTypes.Conversation,
) {
  const stream = yield* awaited(watchEvents(harness, conversation.id, context));
  const batches: durableTypes.AgentEvent[][] = [];
  stream.start((events) => {
    batches.push([...events]);

    return Promise.resolve();
  });
  return { batches, events: () => batches.flat(), stream };
});

const drained = Effect.fn("drained")(function* () {
  yield* Effect.sleep(1);
});

function applyChangesImpl(
  message: aiTypes.AssistantMessage,
  changes: readonly durableTypes.MessageChange[],
): aiTypes.AssistantMessage {
  let next = structuredClone(message);
  for (const change of changes) {
    if (change.type === "message") next = structuredClone(change.message);
    else if (change.type === "block")
      next.content[change.contentIndex] = structuredClone(change.block);
    else if (change.type.endsWith("_start") && "block" in change) {
      next.content.splice(change.contentIndex, 0, structuredClone(change.block));
    } else if (change.type === "text_delta" || change.type === "thinking_delta") {
      const block = next.content[
        change.contentIndex
      ] as unknown as harnessEventsSupportTypes.Mutable;
      const field = change.type === "text_delta" ? "text" : "thinking";
      block[field] = `${block[field] as string}${change.delta}`;
    } else if (change.type === "toolcall_delta") {
      let target = (
        next.content[change.contentIndex] as unknown as harnessEventsSupportTypes.Mutable
      )["arguments"] as harnessEventsSupportTypes.Mutable;
      for (const segment of change.path.slice(0, -1))
        target = target[segment] as harnessEventsSupportTypes.Mutable;
      const last = change.path.at(-1)!;
      target[last] = `${target[last] as string}${change.delta}`;
    }
  }
  return next;
}

const applyChanges: {
  (
    changes: readonly durableTypes.MessageChange[],
  ): (message: aiTypes.AssistantMessage) => ReturnType<typeof applyChangesImpl>;
  (
    message: aiTypes.AssistantMessage,
    changes: readonly durableTypes.MessageChange[],
  ): ReturnType<typeof applyChangesImpl>;
} = dual(2, applyChangesImpl);

const harnessEventsSupport = {
  applyChanges,
  drained,
  listen,
};

export default harnessEventsSupport;
