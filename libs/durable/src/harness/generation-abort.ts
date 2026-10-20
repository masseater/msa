import type { ToolCall } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import { Cause, Effect } from "effect";

import entries from "../entries.ts";
import bridge from "./bridge.ts";
import generationRun from "./generation-run.ts";
import type generationTypesModule from "./generation-types.types.ts";
import liveModule from "./live.ts";
import tool from "./tool.ts";
import type typesModule from "./types.types.ts";

const { AssistantEntry } = entries;
const { commitTask } = bridge;
const { LiveDoc, endRun } = liveModule;
const { appendToolResult, harnessError } = tool;

type AbortTask = typesModule.RunningTask<
  generationTypesModule.GenerationInput,
  generationTypesModule.GenerationCheckpoint,
  generationTypesModule.GenerationResult
>;

const readCalls = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  assistant: typesModule.EntryId,
  callIds: readonly string[],
  context: chordTypes.Context,
) {
  const entry = yield* Effect.promise(() => runtime.entry(AssistantEntry, assistant, context));
  const message = entry?.model?.[0];
  const calls =
    message?.role === "assistant"
      ? message.content.filter((content): content is ToolCall => content.type === "toolCall")
      : [];
  return callIds.flatMap((id) => calls.filter((call) => call.id === id).slice(0, 1));
});

const cancelDeferred = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  checkpoint: Extract<generationTypesModule.GenerationCheckpoint, { phase: "poll" }>,
) {
  const model = runtime.models.getModel(checkpoint.model.provider, checkpoint.model.modelId);
  if (model === undefined) return;
  yield* Effect.catchCause(
    Effect.promise(() =>
      runtime.models.cancelDeferred(model, checkpoint.handle, { signal: runtime.signal }),
    ),
    (cause) => Effect.sync(() => runtime.report(Cause.squash(cause))),
  );
});

const abortGeneration = Effect.fnUntraced(function* (
  task: AbortTask,
  runtime: generationTypesModule.GenerationRuntime,
  context: chordTypes.Context,
) {
  const checkpoint = task.state.checkpoint;
  if (checkpoint.phase === "poll") yield* cancelDeferred(runtime, checkpoint);
  const { conversationId } = runtime;
  const unstarted =
    checkpoint.phase === "tools"
      ? yield* readCalls(runtime, checkpoint.assistant, checkpoint.pending, context)
      : [];
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        yield* generationRun.convertPartial(tx, live, conversationId);
        yield* Effect.forEach(
          unstarted,
          (call) =>
            appendToolResult(
              tx,
              conversationId,
              call,
              harnessError("aborted", `Tool ${call.name} was aborted`),
              { timestamp: runtime.now() },
            ),
          { discard: true },
        );
        endRun(tx, live, runtime.taskId, { reason: "aborted", status: "unanswered" });
        return { outcome: { status: "aborted" }, status: "terminal" };
      }),
    context,
  );
});

const generationAbort = {
  abortGeneration,
};

export default generationAbort;
