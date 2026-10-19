import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { defineDoc } from "../../src/index.ts";
import { createSession } from "../../src/session/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;
const session = createSession(new MemoryStorage());

const Notes = defineDoc<{ text: string }>({
  kind: "example.notes",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ text: "" }),
});

const main = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );

  const firstEntry = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const entry = yield* awaited(tx.appendEntry(chat.id, { kind: "note", data: "hello" }));
            (yield* awaited(tx.doc(Notes, chat.id))).text = "after hello";
            return entry;
          }),
        ),
      context,
    ),
  );

  const secondEntry = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const entry = yield* awaited(
              tx.appendEntry(chat.id, { kind: "note", data: "goodbye" }),
            );
            (yield* awaited(tx.doc(Notes, chat.id))).text = "after goodbye";
            return entry;
          }),
        ),
      context,
    ),
  );

  yield* Console.log("latest notes:", yield* awaited(session.snapshot(Notes, chat.id, context)));
  yield* Console.log(
    "notes at first entry:",
    yield* awaited(session.snapshotAsOf(Notes, chat.id, firstEntry.id, context)),
  );
  yield* Console.log(
    "notes at second entry:",
    yield* awaited(session.snapshotAsOf(Notes, chat.id, secondEntry.id, context)),
  );

  yield* awaited(session.close(context));
});

NodeRuntime.runMain(main);
