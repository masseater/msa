import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { MemoryStorage } = memory;

const { awaited } = effectSupport;
const { openHarness, user } = harnessSupport;
const { context } = sessionSupport;

const root = Effect.fn("root")(function* () {
  const { harness } = yield* openHarness(new MemoryStorage());
  return yield* awaited(harness.root(context));
});

function markerImpl(
  conversation: durableTypes.Conversation,
  head: durableTypes.EntryId | "self",
): Promise<durableTypes.EntryId> {
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
  (
    head: durableTypes.EntryId | "self",
  ): (conversation: durableTypes.Conversation) => ReturnType<typeof markerImpl>;
  (
    conversation: durableTypes.Conversation,
    head: durableTypes.EntryId | "self",
  ): ReturnType<typeof markerImpl>;
} = dual(2, markerImpl);

const harnessPromptSupport = {
  marker,
  root,
};

export default harnessPromptSupport;
