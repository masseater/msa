import { type Context, type JsonValue, copyJson } from "@msa/chord";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import liveModule from "./live.ts";
import toolPhaseKit from "./tool-phase-kit.ts";
import toolTypes from "./tool-types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";
const { commitTask } = bridge;
const { LiveDoc, clearProgress, toolSlot } = liveModule;
const { askHooks, jsonEqual, prepareArguments, readCall, resolveTool, validate } =
  toolPhaseKit.toolCall;
const { fromSlot, harnessError, invalid } = toolPhaseKit.toolResult;
const { settle } = toolPhaseKit.toolSettle;
const { COMPLETED } = toolTypes;
const { run } = toolPhaseKit.toolRun;

type PhaseTask<P extends toolTypesModule.ToolTaskCheckpoint["phase"]> = typesModule.RunningTask<
  toolTypesModule.ToolTaskInput,
  Extract<toolTypesModule.ToolTaskCheckpoint, { phase: P }>,
  toolTypesModule.ToolTaskResult
>;

const commitIntent = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  input: toolTypesModule.ToolTaskInput,
  tool: typesModule.ToolRegistration,
  final: typesModule.JsonObject,
  context: Context,
) {
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        const slot = toolSlot(live, runtime.taskId);
        if (slot !== undefined) slot.status = "running";
        const changed =
          input.kind === "nested" && !jsonEqual(input.call.arguments as JsonValue, final);
        if (changed && slot !== undefined && "parentTaskId" in slot) slot.arguments = final;
        return {
          checkpoint: { arguments: final, phase: "execute", replay: tool.replay ?? "unsafe" },
          status: "running",
        } as const;
      }),
    context,
  );
});

const callPhase = Effect.fnUntraced(function* (
  task: PhaseTask<"call">,
  runtime: toolTypesModule.ToolRuntime,
  context: Context,
) {
  const call = yield* readCall(runtime, task.input, context);
  const tool = yield* resolveTool(runtime, task.input, call.name, context);
  if (tool === undefined) {
    const error = harnessError("tool_unavailable", `Tool ${call.name} is not available`);
    return yield* settle(runtime, task.input, call, COMPLETED, () => error, context);
  }
  const prepared = prepareArguments(tool, call.arguments as typesModule.JsonObject);
  const checked = "error" in prepared ? prepared : validate(tool, call, prepared.args);
  if ("error" in checked)
    return yield* settle(
      runtime,
      task.input,
      call,
      COMPLETED,
      () => invalid(checked.error),
      context,
    );
  const asked = yield* askHooks(runtime, call, checked.args, context);
  if (asked.block !== undefined) {
    const blocked = harnessError("blocked", `Tool call blocked: ${asked.block}`);
    return yield* settle(runtime, task.input, call, COMPLETED, () => blocked, context);
  }
  const validated = validate(tool, call, asked.args);
  if ("error" in validated)
    return yield* settle(
      runtime,
      task.input,
      call,
      COMPLETED,
      () => invalid(validated.error),
      context,
    );
  const final = copyJson(validated.args, {
    omitUndefinedProperties: true,
  }) as typesModule.JsonObject;
  yield* commitIntent(runtime, task.input, tool, final, context);
  yield* run(runtime, task.input, call, tool, final, context);
});

const executePhase = Effect.fnUntraced(function* (
  task: PhaseTask<"execute">,
  runtime: toolTypesModule.ToolRuntime,
  context: Context,
) {
  const { arguments: args, replay } = task.state.checkpoint;
  const call = yield* readCall(runtime, task.input, context);
  const tool = yield* resolveTool(runtime, task.input, call.name, context);
  if (replay === "safe" && tool?.replay === "safe") {
    yield* commitTask(
      runtime,
      (tx: typesModule.Tx) =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          const slot = toolSlot(live, runtime.taskId);
          if (slot !== undefined) clearProgress(slot);
          return undefined;
        }),
      context,
    );
    return yield* run(runtime, task.input, call, tool, args, context);
  }
  const message = `Tool ${call.name} was interrupted and may have partially run`;
  yield* settle(
    runtime,
    task.input,
    call,
    { message, status: "failed" },
    (slot) => fromSlot(slot, "interrupted", message),
    context,
  );
});

const abortPhase = Effect.fnUntraced(function* (
  task: typesModule.RunningTask<
    toolTypesModule.ToolTaskInput,
    toolTypesModule.ToolTaskCheckpoint,
    toolTypesModule.ToolTaskResult
  > & {
    readonly abortReason?: string;
  },
  runtime: toolTypesModule.ToolRuntime,
  context: Context,
) {
  const call = yield* readCall(runtime, task.input, context);
  const [code, message] = abortMessage(task, call.name);
  yield* settle(
    runtime,
    task.input,
    call,
    { status: "aborted" },
    (slot) => fromSlot(slot, code, message),
    context,
  );
});

const abortMessage = (
  task: typesModule.RunningTask<
    toolTypesModule.ToolTaskInput,
    toolTypesModule.ToolTaskCheckpoint,
    toolTypesModule.ToolTaskResult
  > & {
    readonly abortReason?: string;
  },
  name: string,
): readonly [string, string] => {
  if (task.abortReason !== "restart") return ["aborted", `Tool ${name} was aborted`];
  return task.state.checkpoint.phase === "execute"
    ? ["interrupted", `Tool ${name} was interrupted by a restart and may have partially run`]
    : ["abandoned", `Tool ${name} was not started: its caller ended with a restart`];
};

const toolPhases = {
  abortPhase,
  callPhase,
  executePhase,
};

export default toolPhases;
