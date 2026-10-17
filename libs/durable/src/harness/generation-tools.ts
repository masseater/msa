import type { AssistantMessage, ToolCall } from "@msa/ai";
import { getCurrentTools } from "@msa/ai/utils/transcript";
import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { commitTask } from "./bridge.ts";
import { appendAssistant } from "./generation-run.ts";
import type {
  GenerationCheckpoint,
  GenerationNext,
  GenerationRequest,
  GenerationRuntime,
} from "./generation-types.ts";
import { LiveDoc, type ToolSlot } from "./live.ts";
import { appendToolResult, harnessError, ToolTask, type ToolTaskResult } from "./tool.ts";
import type { EntryId, TaskId, Tx } from "./types.ts";

export const createToolTask: {
  (
    runtime: GenerationRuntime,
    assistant: EntryId,
    callId: string,
  ): (tx: Tx) => Effect.Effect<TaskId<ToolTaskResult>>;
  (
    tx: Tx,
    runtime: GenerationRuntime,
    assistant: EntryId,
    callId: string,
  ): Effect.Effect<TaskId<ToolTaskResult>>;
} = Function.dual(
  4,
  (
    tx: Tx,
    runtime: GenerationRuntime,
    assistant: EntryId,
    callId: string,
  ): Effect.Effect<TaskId<ToolTaskResult>> =>
    Effect.promise(() =>
      tx.createTask(
        ToolTask,
        { kind: "model", assistant, callId },
        { ownership: { kind: "task", taskId: runtime.taskId } },
      ),
    ),
);

type Round = {
  readonly slots: ToolSlot[];
  readonly started: TaskId<ToolTaskResult>[];
  readonly pending: string[];
};

const placeCall = Effect.fn("placeCall")(function* (
  tx: Tx,
  runtime: GenerationRuntime,
  round: Round,
  input: {
    readonly call: ToolCall;
    readonly assistant: EntryId;
    readonly offered: ReadonlySet<string>;
    readonly sequential: boolean;
  },
) {
  const { call, assistant, offered, sequential } = input;
  if (!offered.has(call.name)) {
    const unavailable = harnessError("tool_unavailable", `Tool ${call.name} is not available`);
    const result = yield* appendToolResult(tx, runtime.conversationId, call, unavailable, {
      timestamp: runtime.now(),
    });
    round.slots.push({ callId: call.id, name: call.name, status: "done", entry: result.id });
    return;
  }
  if (sequential && round.started.length > 0) {
    round.pending.push(call.id);
    round.slots.push({ callId: call.id, name: call.name, status: "pending" });
    return;
  }
  const taskId = yield* createToolTask(tx, runtime, assistant, call.id);
  round.started.push(taskId);
  round.slots.push({ callId: call.id, name: call.name, taskId, status: "pending" });
});

const isSequential = Effect.fn("isSequential")(function* (
  runtime: GenerationRuntime,
  calls: readonly ToolCall[],
  offered: ReadonlySet<string>,
  context: Context,
) {
  if (runtime.settings.toolExecution === "sequential") return true;
  const agent = yield* Effect.promise(() => runtime.agent(context));
  return calls.some(
    (call) =>
      offered.has(call.name) &&
      agent.tools.find((tool) => tool.name === call.name)?.executionMode === "sequential",
  );
});

export const startToolRound = Effect.fn("startToolRound")(function* (
  runtime: GenerationRuntime,
  request: GenerationRequest,
  message: AssistantMessage,
  calls: readonly ToolCall[],
  context: Context,
) {
  const { conversationId } = runtime;
  const messages =
    request.messages ??
    (yield* Effect.promise(() => runtime.context(conversationId, context, { at: request.cutoff })))
      .messages;
  const offered = new Set(getCurrentTools(messages).map((tool) => tool.name));
  const sequential = yield* isSequential(runtime, calls, offered, context);
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        const entry = yield* appendAssistant(tx, conversationId, message);
        const round: Round = { slots: [], started: [], pending: [] };
        yield* Effect.forEach(
          calls,
          (call) =>
            placeCall(tx, runtime, round, {
              call,
              assistant: entry.id,
              offered,
              sequential,
            }),
          { discard: true },
        );
        delete live.generation;
        live.tools = round.slots;
        const checkpoint: GenerationCheckpoint = {
          phase: "tools",
          assistant: entry.id,
          tools: round.started,
          pending: round.pending,
        };
        return { status: "waiting", checkpoint, on: round.started, policy: "allSettled" };
      }),
    context,
  );
});
