import type { Conversation, EntryId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import { openHarness, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

export const root = Effect.fn("root")(function* () {
  const { harness } = yield* openHarness(new MemoryStorage());
  return yield* awaited(harness.root(context));
});

function markerImpl(conversation: Conversation, head: EntryId | "self"): Promise<EntryId> {
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

export const marker: {
  (head: EntryId | "self"): (conversation: Conversation) => ReturnType<typeof markerImpl>;
  (conversation: Conversation, head: EntryId | "self"): ReturnType<typeof markerImpl>;
} = dual(2, markerImpl);
