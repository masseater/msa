import type { Conversation, EntryId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { openHarness, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

export const root = Effect.fn("root")(function* () {
  const { harness } = yield* openHarness(new MemoryStorage());
  return yield* awaited(harness.root(context));
});

export function marker(conversation: Conversation, head: EntryId | "self"): Promise<EntryId> {
  return Promise.resolve(
    conversation.commit(
      (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return (yield* awaited(
              tx.appendEntry(conversation.id, { kind: "summary", head, model: [user("summary")] }),
            )).id;
          }),
        ),
      context,
    ),
  );
}
