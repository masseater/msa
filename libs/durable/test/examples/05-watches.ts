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

  const notesWatch = yield* awaited(session.watchDoc(Notes, chat.id, context));
  if (notesWatch === undefined) throw new Error("notes are absent");
  yield* Console.log("watch baseline:", notesWatch.value);
  const delivered = new Promise<void>((resolve) => {
    notesWatch.start((value, _ops, _deliveryContext) => {
      runSync(Console.log("watch update:", value));
      resolve();

      return Promise.resolve();
    });
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes, chat.id))).text = "observed asynchronously";
          }),
        ),
      context,
    ),
  );
  yield* awaited(delivered);
  yield* awaited(notesWatch.stop());

  yield* awaited(session.close(context));
});

NodeRuntime.runMain(main);
