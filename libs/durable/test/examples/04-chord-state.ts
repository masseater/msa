import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import durable from "../../src/index.ts";
import sessionModule from "../../src/session/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { createSession } = sessionModule;
const { MemoryStorage } = memory;
const { defineDoc } = durable;

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

const main = Effect.gen(function* () {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());

  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const conversation = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            (yield* awaited(tx.doc(Notes, conversation.id))).text = "first";
            return conversation;
          }),
        ),
      context,
    ),
  );

  const notesState = yield* awaited(session.documentState(Notes, chat.id, context));
  if (notesState === undefined) throw new Error("notes are absent");
  const stopNotes = notesState.subscribe((value, _deliveryContext, delivery) => {
    runSync(Console.log("Chord notes:", delivery.kind, delivery.sequence, value));
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes, chat.id))).text = "published through Chord";
          }),
        ),
      context,
    ),
  );
  stopNotes();
  notesState.dispose();

  yield* awaited(session.close(context));
});

NodeRuntime.runMain(main);
