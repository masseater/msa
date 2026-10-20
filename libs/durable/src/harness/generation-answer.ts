import type { AssistantMessage } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import entries from "../entries.ts";
import bridge from "./bridge.ts";
import generationRun from "./generation-run.ts";
import type generationTypesModule from "./generation-types.types.ts";
import inboxModule from "./inbox.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";

const { commitTask, eachHook, hookResult } = bridge;
const { applyBoundary, prepareBoundary } = inboxModule;
const { LiveDoc, endRun } = liveModule;
const { UserEntry } = entries;

const askContinuation = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  message: AssistantMessage,
  context: Context,
) {
  let continuation: typesModule.UserInput | undefined;
  yield* eachHook(runtime.hooks, "onYield", (hook) =>
    continuation === undefined
      ? Effect.map(
          hookResult(() => hook(message, runtime, context)),
          (made) => {
            continuation = made?.continue;
          },
        )
      : Effect.void,
  );
  return continuation;
});

const answer = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  message: AssistantMessage,
  context: Context,
) {
  const continuation = yield* askContinuation(runtime, message, context);
  const { conversationId } = runtime;
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const boundary = yield* prepareBoundary(tx, conversationId, runtime.settings);
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        const entry = yield* generationRun.appendAssistant(tx, conversationId, message);
        const result: generationTypesModule.GenerationNext = {
          outcome: { result: { entryId: entry.id }, status: "completed" },
          status: "terminal",
        };
        const { users, reset } = yield* applyBoundary(tx, boundary, "final", runtime.now());
        if (continuation !== undefined && users.length === 0 && !reset) {
          const user = { content: continuation, role: "user", timestamp: runtime.now() } as const;
          yield* Effect.promise(() => tx.appendEntry(UserEntry, conversationId, { model: [user] }));
          generationRun.handOver(
            live,
            runtime.taskId,
            yield* generationRun.createGeneration(tx, conversationId),
          );
          delete live.generation;
          return result;
        }
        endRun(tx, live, runtime.taskId, { answer: entry.id, status: "done" });
        if (users.length > 0) yield* generationRun.startRun(tx, conversationId, live, users);
        return result;
      }),
    context,
  );
});

const generationAnswer = {
  answer,
};

export default generationAnswer;
