import { type Context, copyJson, type JsonValue } from "@msa/chord";
import { Effect } from "effect";

import { commitTask } from "./bridge.ts";
import { clearProgress, LiveDoc, toolSlot } from "./live.ts";
import {
  askHooks,
  jsonEqual,
  prepareArguments,
  readCall,
  resolveTool,
  validate,
} from "./tool-call.ts";
import { fromSlot, harnessError, invalid } from "./tool-result.ts";
import { run } from "./tool-run.ts";
import { settle } from "./tool-settle.ts";
import {
  COMPLETED,
  type ToolRuntime,
  type ToolTaskCheckpoint,
  type ToolTaskInput,
  type ToolTaskResult,
} from "./tool-types.ts";
import type { JsonObject, RunningTask, ToolRegistration, Tx } from "./types.ts";

type PhaseTask<P extends ToolTaskCheckpoint["phase"]> = RunningTask<
  ToolTaskInput,
  Extract<ToolTaskCheckpoint, { phase: P }>,
  ToolTaskResult
>;

const commitIntent = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  input: ToolTaskInput,
  tool: ToolRegistration,
  final: JsonObject,
  context: Context,
) {
  yield* commitTask(
    runtime,
    (tx: Tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        const slot = toolSlot(live, runtime.taskId);
        if (slot !== undefined) slot.status = "running";
        const changed =
          input.kind === "nested" && !jsonEqual(input.call.arguments as JsonValue, final);
        if (changed && slot !== undefined && "parentTaskId" in slot) slot.arguments = final;
        return {
          status: "running",
          checkpoint: { phase: "execute", arguments: final, replay: tool.replay ?? "unsafe" },
        } as const;
      }),
    context,
  );
});

export const callPhase = Effect.fnUntraced(function* (
  task: PhaseTask<"call">,
  runtime: ToolRuntime,
  context: Context,
) {
  const call = yield* readCall(runtime, task.input, context);
  const tool = yield* resolveTool(runtime, task.input, call.name, context);
  if (tool === undefined) {
    const error = harnessError("tool_unavailable", `Tool ${call.name} is not available`);
    return yield* settle(runtime, task.input, call, COMPLETED, () => error, context);
  }
  const prepared = prepareArguments(tool, call.arguments as JsonObject);
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
  const final = copyJson(validated.args, { omitUndefinedProperties: true }) as JsonObject;
  yield* commitIntent(runtime, task.input, tool, final, context);
  yield* run(runtime, task.input, call, tool, final, context);
});

export const executePhase = Effect.fnUntraced(function* (
  task: PhaseTask<"execute">,
  runtime: ToolRuntime,
  context: Context,
) {
  const { arguments: args, replay } = task.state.checkpoint;
  const call = yield* readCall(runtime, task.input, context);
  const tool = yield* resolveTool(runtime, task.input, call.name, context);
  if (replay === "safe" && tool?.replay === "safe") {
    yield* commitTask(
      runtime,
      (tx: Tx) =>
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
    { status: "failed", message },
    (slot) => fromSlot(slot, "interrupted", message),
    context,
  );
});

export const abortPhase = Effect.fnUntraced(function* (
  task: RunningTask<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult> & {
    readonly abortReason?: string;
  },
  runtime: ToolRuntime,
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
  task: RunningTask<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult> & {
    readonly abortReason?: string;
  },
  name: string,
): readonly [string, string] => {
  if (task.abortReason !== "restart") return ["aborted", `Tool ${name} was aborted`];
  return task.state.checkpoint.phase === "execute"
    ? ["interrupted", `Tool ${name} was interrupted by a restart and may have partially run`]
    : ["abandoned", `Tool ${name} was not started: its caller ended with a restart`];
};
