import { type AssistantMessage } from "@msa/ai";
import {
  type AgentEvent,
  type Conversation,
  type Harness,
  type MessageChange,
  watchEvents,
} from "@msa/durable";

import { context } from "./session-support.ts";

// Attach and start an event stream that records every delivered batch.
export async function listen(harness: Harness, conversation: Conversation) {
  const stream = await watchEvents(harness, conversation.id, context);
  const batches: AgentEvent[][] = [];
  stream.start((events) => {
    batches.push([...events]);

    return Promise.resolve();
  });
  return { stream, batches, events: () => batches.flat() };
}

export async function drained(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export type Mutable = { [key: string]: unknown };

// Apply message changes to a copy of `message`, as an events-only consumer would.
export function applyChanges(
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
