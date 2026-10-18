import { type Conversation, defineDoc, type EntryRecord, type ScanOrder } from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import { user } from "./harness-support.ts";
import { context } from "./session-support.ts";

export const directories = new Set<string>();

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const NoteDoc = defineDoc<{ text: string }>({
  kind: "test.note",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ text: "" }),
});

function appendImpl(conversation: Conversation, text: string): Promise<EntryRecord> {
  return Promise.resolve(
    conversation.commit(
      (tx) => tx.appendEntry(conversation.id, { kind: "message", model: [user(text)] }),
      context,
    ),
  );
}

export const append: {
  (text: string): (conversation: Conversation) => ReturnType<typeof appendImpl>;
  (conversation: Conversation, text: string): ReturnType<typeof appendImpl>;
} = dual(2, appendImpl);

export const allEntries = Effect.fn("allEntries")(function* (
  conversation: Conversation,
  order?: ScanOrder,
  start?: Parameters<Conversation["entries"]>[2],
) {
  const texts: string[] = [];
  let cursor = start;
  do {
    const page = yield* awaited(
      conversation.entries(order === undefined ? {} : { order }, 2, cursor, context),
    );
    for (const entry of page.items) {
      const firstModel = entry.model?.[0] as { content: string } | undefined;
      if (firstModel !== undefined) texts.push(firstModel.content);
    }
    cursor = page.next;
  } while (cursor !== undefined);
  return texts;
});
