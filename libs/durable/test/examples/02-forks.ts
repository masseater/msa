import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { defineDoc } from "../../src/index.ts";
import { createSession } from "../../src/session/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;
const session = createSession(new MemoryStorage());

const Notes = defineDoc<{ text: string }>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ text: "" }),
  kind: "example.notes",
  scope: "conversation",
  version: 1,
});

const mainStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  const firstEntry = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const entry = yield* awaited(tx.appendEntry(chat.id, { data: "hello", kind: "note" }));
            (yield* awaited(tx.doc(Notes, chat.id))).text = "after hello";
            return entry;
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.appendEntry(chat.id, { data: "goodbye", kind: "note" }));
            (yield* awaited(tx.doc(Notes, chat.id))).text = "after goodbye";
          }),
        ),
      context,
    ),
  );

  const branch = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(chat.id, firstEntry.id, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );

  const branchEntries = yield* awaited(
    session.commit((tx) => tx.scanEntries({ conversationId: branch.id }, 10), context),
  );
  return { branch, branchEntries, chat, runPromise };
});

const main = Effect.gen(function* () {
  const { runPromise, chat, branch, branchEntries } = yield* mainStep1;
  yield* Console.log(
    "fork transcript:",
    branchEntries.items.map((entry) => entry.data),
  );
  yield* Console.log("fork notes:", yield* awaited(session.snapshot(Notes, branch.id, context)));

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes, branch.id))).text = "changed only in the fork";
          }),
        ),
      context,
    ),
  );
  yield* Console.log(
    "fork notes after edit:",
    yield* awaited(session.snapshot(Notes, branch.id, context)),
  );
  yield* Console.log(
    "parent notes after edit:",
    yield* awaited(session.snapshot(Notes, chat.id, context)),
  );

  yield* awaited(session.close(context));
});

NodeRuntime.runMain(main);
