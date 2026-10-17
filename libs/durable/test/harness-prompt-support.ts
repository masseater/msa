import { type Conversation, type EntryId, MemoryStorage } from "@msa/durable";

import { openHarness, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

export async function root(): Promise<Conversation> {
  const { harness } = await openHarness(new MemoryStorage());
  return harness.root(context);
}

export function marker(conversation: Conversation, head: EntryId | "self"): Promise<EntryId> {
  return Promise.resolve(
    conversation.commit(
      async (tx) =>
        (await tx.appendEntry(conversation.id, { kind: "summary", head, model: [user("summary")] }))
          .id,
      context,
    ),
  );
}
