import type { AssistantMessage, ToolCall } from "@msa/ai";
import { getCurrentTools } from "@msa/ai/utils/transcript";
import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import bridge from "./bridge.ts";
import generationRun from "./generation-run.ts";
import type generationToolsTypes from "./generation-tools.types.ts";
import liveModule from "./live.ts";
import toolModule from "./tool.ts";
import type typesModule from "./types.types.ts";

const { ToolTask, appendToolResult, harnessError } = toolModule;
const { commitTask } = bridge;
const { LiveDoc } = liveModule;
const createToolTask: {
  (
    runtime: generationToolsTypes.GenerationRuntime,
    assistant: typesModule.EntryId,
    callId: string,
  ): (tx: typesModule.Tx) => Effect.Effect<typesModule.TaskId<generationToolsTypes.ToolTaskResult>>;
  (
    tx: typesModule.Tx,
    runtime: generationToolsTypes.GenerationRuntime,
    assistant: typesModule.EntryId,
    callId: string,
  ): Effect.Effect<typesModule.TaskId<generationToolsTypes.ToolTaskResult>>;
} = Function.dual(
  4,
  (
    tx: typesModule.Tx,
    runtime: generationToolsTypes.GenerationRuntime,
    assistant: typesModule.EntryId,
    callId: string,
  ): Effect.Effect<typesModule.TaskId<generationToolsTypes.ToolTaskResult>> =>
    Effect.promise(() =>
      tx.createTask(
        ToolTask,
        { assistant, callId, kind: "model" },
        { ownership: { kind: "task", taskId: runtime.taskId } },
      ),
    ),
);

type Round = {
  readonly slots: generationToolsTypes.ToolSlot[];
  readonly started: typesModule.TaskId<generationToolsTypes.ToolTaskResult>[];
  readonly pending: string[];
};

const placeCall = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  runtime: generationToolsTypes.GenerationRuntime,
  round: Round,
  input: {
    readonly call: ToolCall;
    readonly assistant: typesModule.EntryId;
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
    round.slots.push({ callId: call.id, entry: result.id, name: call.name, status: "done" });
    return;
  }
  if (sequential && round.started.length > 0) {
    round.pending.push(call.id);
    round.slots.push({ callId: call.id, name: call.name, status: "pending" });
    return;
  }
  const taskId = yield* createToolTask(tx, runtime, assistant, call.id);
  round.started.push(taskId);
  round.slots.push({ callId: call.id, name: call.name, status: "pending", taskId });
});

const isSequential = Effect.fnUntraced(function* (
  runtime: generationToolsTypes.GenerationRuntime,
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

const startToolRound = Effect.fnUntraced(function* (
  runtime: generationToolsTypes.GenerationRuntime,
  request: generationToolsTypes.GenerationRequest,
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
    (tx: typesModule.Tx): Effect.Effect<generationToolsTypes.GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        const entry = yield* generationRun.appendAssistant(tx, conversationId, message);
        const round: Round = { pending: [], slots: [], started: [] };
        yield* Effect.forEach(
          calls,
          (call) =>
            placeCall(tx, runtime, round, {
              assistant: entry.id,
              call,
              offered,
              sequential,
            }),
          { discard: true },
        );
        delete live.generation;
        live.tools = round.slots;
        const checkpoint: generationToolsTypes.GenerationCheckpoint = {
          assistant: entry.id,
          pending: round.pending,
          phase: "tools",
          tools: round.started,
        };
        return { checkpoint, on: round.started, policy: "allSettled", status: "waiting" };
      }),
    context,
  );
});

const generationTools = {
  createToolTask,
  startToolRound,
};

export default generationTools;
