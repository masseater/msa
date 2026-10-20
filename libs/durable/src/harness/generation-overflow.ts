import type { AssistantMessage } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import compactionModule from "./compaction.ts";
import generationRun from "./generation-run.ts";
import type generationTypesModule from "./generation-types.types.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";
const { commitTask } = bridge;
const { LiveDoc } = liveModule;
const compactOverflow = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  request: generationTypesModule.GenerationRequest,
  message: AssistantMessage,
  context: Context,
) {
  const { conversationId } = runtime;
  const policy = runtime.settings.compaction;
  const view = yield* Effect.promise(() =>
    runtime.context(conversationId, context, { at: request.cutoff }),
  );
  if (compactionModule.selectCut(view, policy.keepRecentTokens) === undefined) return false;
  const text = message.errorMessage ?? "Context overflow";
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        yield* generationRun.appendAssistant(tx, conversationId, message);
        delete live.generation;
        const child = yield* compactionModule.createCompaction(
          tx,
          conversationId,
          { reason: "overflow" },
          runtime.taskId,
        );
        const checkpoint = {
          attempt: request.attempt,
          compacted: child,
          overflow: text,
          phase: "prepare",
        } as const;
        return { checkpoint, on: [child], policy: "allSettled", status: "waiting" };
      }),
    context,
  );
  return true;
});

const generationOverflow = {
  compactOverflow,
};

export default generationOverflow;
