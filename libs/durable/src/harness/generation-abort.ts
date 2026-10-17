import type { ToolCall } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Cause, Effect } from "effect";

import { AssistantEntry } from "../entries.ts";
import { commitTask } from "./bridge.ts";
import { convertPartial } from "./generation-run.ts";
import type {
  GenerationCheckpoint,
  GenerationInput,
  GenerationNext,
  GenerationResult,
  GenerationRuntime,
} from "./generation-types.ts";
import { endRun, LiveDoc } from "./live.ts";
import { appendToolResult, harnessError } from "./tool.ts";
import type { EntryId, RunningTask, Tx } from "./types.ts";

type AbortTask = RunningTask<GenerationInput, GenerationCheckpoint, GenerationResult>;

const readCalls = Effect.fn("readCalls")(function* (
  runtime: GenerationRuntime,
  assistant: EntryId,
  callIds: readonly string[],
  context: Context,
) {
  const entry = yield* Effect.promise(() => runtime.entry(AssistantEntry, assistant, context));
  const message = entry?.model?.[0];
  const calls =
    message?.role === "assistant"
      ? message.content.filter((content): content is ToolCall => content.type === "toolCall")
      : [];
  return callIds.flatMap((id) => calls.filter((call) => call.id === id).slice(0, 1));
});

const cancelDeferred = Effect.fn("cancelDeferred")(function* (
  runtime: GenerationRuntime,
  checkpoint: Extract<GenerationCheckpoint, { phase: "poll" }>,
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

export const abortGeneration = Effect.fn("abortGeneration")(function* (
  task: AbortTask,
  runtime: GenerationRuntime,
  context: Context,
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
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        yield* convertPartial(tx, live, conversationId);
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
        endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "aborted" });
        return { status: "terminal", outcome: { status: "aborted" } };
      }),
    context,
  );
});
