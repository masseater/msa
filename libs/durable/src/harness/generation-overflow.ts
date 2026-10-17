import type { AssistantMessage } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { commitTask } from "./bridge.ts";
import { createCompaction, selectCut } from "./compaction.ts";
import { appendAssistant } from "./generation-run.ts";
import type { GenerationNext, GenerationRequest, GenerationRuntime } from "./generation-types.ts";
import { LiveDoc } from "./live.ts";
import type { Tx } from "./types.ts";

export const compactOverflow = Effect.fn("compactOverflow")(function* (
  runtime: GenerationRuntime,
  request: GenerationRequest,
  message: AssistantMessage,
  context: Context,
) {
  const { conversationId } = runtime;
  const policy = runtime.settings.compaction;
  const view = yield* Effect.promise(() =>
    runtime.context(conversationId, context, { at: request.cutoff }),
  );
  if (selectCut(view, policy.keepRecentTokens) === undefined) return false;
  const text = message.errorMessage ?? "Context overflow";
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        yield* appendAssistant(tx, conversationId, message);
        delete live.generation;
        const child = yield* createCompaction(
          tx,
          conversationId,
          { reason: "overflow" },
          runtime.taskId,
        );
        const checkpoint = {
          phase: "prepare",
          attempt: request.attempt,
          compacted: child,
          overflow: text,
        } as const;
        return { status: "waiting", checkpoint, on: [child], policy: "allSettled" };
      }),
    context,
  );
  return true;
});
