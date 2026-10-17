import { type Conversation, defineDoc, type EntryRecord, type ScanOrder } from "@msa/durable";

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

export function append(conversation: Conversation, text: string): Promise<EntryRecord> {
  return Promise.resolve(
    conversation.commit(
      (tx) => tx.appendEntry(conversation.id, { kind: "message", model: [user(text)] }),
      context,
    ),
  );
}

export async function allEntries(
  conversation: Conversation,
  order?: ScanOrder,
  cursor?: Parameters<Conversation["entries"]>[2],
): Promise<string[]> {
  const page = await conversation.entries(order === undefined ? {} : { order }, 2, cursor, context);
  const texts: string[] = [];
  for (const entry of page.items) {
    const firstModel = entry.model?.[0] as { content: string } | undefined;
    if (firstModel !== undefined) texts.push(firstModel.content);
  }
  return page.next === undefined
    ? texts
    : [...texts, ...(await allEntries(conversation, order, page.next))];
}
