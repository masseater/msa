import { type AssistantMessage } from "@msa/ai";
import type { AgentEvent, Conversation, Harness, MessageChange } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export const listen = Effect.fn("listen")(function* (harness: Harness, conversation: Conversation) {
  const stream = yield* awaited(watchEvents(harness, conversation.id, context));
  const batches: AgentEvent[][] = [];
  stream.start((events) => {
    batches.push([...events]);

    return Promise.resolve();
  });
  return { stream, batches, events: () => batches.flat() };
});

export const drained = Effect.fn("drained")(function* () {
  yield* Effect.sleep(1);
});

export type Mutable = { [key: string]: unknown };

function applyChangesImpl(
  message: AssistantMessage,
  changes: readonly MessageChange[],
): AssistantMessage {
  let next = structuredClone(message);
  for (const change of changes) {
    if (change.type === "message") next = structuredClone(change.message);
    else if (change.type === "block")
      next.content[change.contentIndex] = structuredClone(change.block);
    else if (change.type.endsWith("_start") && "block" in change) {
      next.content.splice(change.contentIndex, 0, structuredClone(change.block));
    } else if (change.type === "text_delta" || change.type === "thinking_delta") {
      const block = next.content[change.contentIndex] as unknown as Mutable;
      const field = change.type === "text_delta" ? "text" : "thinking";
      block[field] = `${block[field] as string}${change.delta}`;
    } else if (change.type === "toolcall_delta") {
      let target = (next.content[change.contentIndex] as unknown as Mutable)[
        "arguments"
      ] as Mutable;
      for (const segment of change.path.slice(0, -1)) target = target[segment] as Mutable;
      const last = change.path.at(-1)!;
      target[last] = `${target[last] as string}${change.delta}`;
    }
  }
  return next;
}

export const applyChanges: {
  (
    changes: readonly MessageChange[],
  ): (message: AssistantMessage) => ReturnType<typeof applyChangesImpl>;
  (
    message: AssistantMessage,
    changes: readonly MessageChange[],
  ): ReturnType<typeof applyChangesImpl>;
} = dual(2, applyChangesImpl);
