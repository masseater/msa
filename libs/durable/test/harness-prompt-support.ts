import type { Conversation, EntryId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { openHarness, user } = harnessSupport;
const { context } = sessionSupport;

const root = Effect.fn("root")(function* () {
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
              tx.appendEntry(conversation.id, { head, kind: "summary", model: [user("summary")] }),
            )).id;
          }),
        ),
      context,
    ),
  );
}

const marker: {
  (head: EntryId | "self"): (conversation: Conversation) => ReturnType<typeof markerImpl>;
  (conversation: Conversation, head: EntryId | "self"): ReturnType<typeof markerImpl>;
} = dual(2, markerImpl);

const harnessPromptSupport = {
  marker,
  root,
};

export default harnessPromptSupport;
