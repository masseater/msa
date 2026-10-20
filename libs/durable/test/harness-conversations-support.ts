import { type Conversation, type EntryRecord, type ScanOrder, defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { user } = harnessSupport;
const { context } = sessionSupport;

const directories = new Set<string>();

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const NoteDoc = defineDoc<{ text: string }>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ text: "" }),
  kind: "test.note",
  scope: "conversation",
  version: 1,
});

function appendImpl(conversation: Conversation, text: string): Promise<EntryRecord> {
  return Promise.resolve(
    conversation.commit(
      (tx) => tx.appendEntry(conversation.id, { kind: "message", model: [user(text)] }),
      context,
    ),
  );
}

const append: {
  (text: string): (conversation: Conversation) => ReturnType<typeof appendImpl>;
  (conversation: Conversation, text: string): ReturnType<typeof appendImpl>;
} = dual(2, appendImpl);

const allEntries = Effect.fn("allEntries")(function* (
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

const harnessConversationsSupport = {
  NoteDoc,
  UUID_V7,
  allEntries,
  append,
  directories,
};

export default harnessConversationsSupport;
