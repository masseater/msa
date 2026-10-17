import type { AssistantMessage } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { UserEntry } from "../entries.ts";
import { commitTask, eachHook, hookResult } from "./bridge.ts";
import { appendAssistant, createGeneration, handOver, startRun } from "./generation-run.ts";
import type { GenerationNext, GenerationRuntime } from "./generation-types.ts";
import { applyBoundary, prepareBoundary } from "./inbox.ts";
import { endRun, LiveDoc } from "./live.ts";
import type { Tx, UserInput } from "./types.ts";

const askContinuation = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  message: AssistantMessage,
  context: Context,
) {
  let continuation: UserInput | undefined;
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

export const answer = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  message: AssistantMessage,
  context: Context,
) {
  const continuation = yield* askContinuation(runtime, message, context);
  const { conversationId } = runtime;
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const boundary = yield* prepareBoundary(tx, conversationId, runtime.settings);
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        const entry = yield* appendAssistant(tx, conversationId, message);
        const result: GenerationNext = {
          status: "terminal",
          outcome: { status: "completed", result: { entryId: entry.id } },
        };
        const { users, reset } = yield* applyBoundary(tx, boundary, "final", runtime.now());
        if (continuation !== undefined && users.length === 0 && !reset) {
          const user = { role: "user", content: continuation, timestamp: runtime.now() } as const;
          yield* Effect.promise(() => tx.appendEntry(UserEntry, conversationId, { model: [user] }));
          handOver(live, runtime.taskId, yield* createGeneration(tx, conversationId));
          delete live.generation;
          return result;
        }
        endRun(tx, live, runtime.taskId, { status: "done", answer: entry.id });
        if (users.length > 0) yield* startRun(tx, conversationId, live, users);
        return result;
      }),
    context,
  );
});
