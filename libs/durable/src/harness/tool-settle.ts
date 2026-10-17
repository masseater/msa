import {
  type Context,
  copyJson,
  type Draft,
  type JsonRepresentation,
  type JsonValue,
} from "@msa/chord";
import { Effect } from "effect";

import { commitTask } from "./bridge.ts";
import { finishSlot, LiveDoc, removeNestedSlots, toolSlot } from "./live.ts";
import { appendToolResult, nestedResult, summaryOf } from "./tool-result.ts";
import {
  MADE_NESTED_CALLS,
  NestedCallDoc,
  type Ending,
  type ToolRuntime,
  type ToolTaskInput,
  type ToolTaskResult,
  TOOL_TASK_NAME,
} from "./tool-types.ts";
import type {
  NestedToolExecutionResult,
  ToolControl,
  ToolExecutionResult,
  ToolHookCall,
  Tx,
} from "./types.ts";
import { recordUsage } from "./usage.ts";

type SlotOf = ReturnType<typeof toolSlot>;

const abortNested = Effect.fnUntraced(function* (runtime: ToolRuntime, context: Context) {
  const owned = yield* Effect.promise(() => runtime.ownedTasks(context));
  const nestedIds = owned
    .filter(
      (record) =>
        record.kind === TOOL_TASK_NAME && (record.input as ToolTaskInput).kind === "nested",
    )
    .map((record) => record.id);
  const madeNested =
    (yield* Effect.promise(() => runtime.memo(MADE_NESTED_CALLS, context))) === true;
  yield* Effect.forEach(nestedIds, (id) => Effect.promise(() => runtime.abortOwned(id, context)), {
    concurrency: "unbounded",
    discard: true,
  });
  return madeNested;
});

const settleNested = Effect.fnUntraced(function* (
  tx: Tx,
  runtime: ToolRuntime,
  state: { readonly input: Extract<ToolTaskInput, { kind: "nested" }>; readonly slot: SlotOf },
  outcome: {
    readonly call: ToolHookCall;
    readonly result: ToolExecutionResult;
    readonly durationMs: number | undefined;
  },
) {
  const nested = nestedResult(runtime.taskId, outcome.result, outcome.durationMs);
  if (nested.usage !== undefined)
    yield* recordUsage(tx, runtime.conversationId, "tools", outcome.call.name, nested.usage);
  const stored = yield* Effect.promise(() =>
    tx.doc(NestedCallDoc, state.input.parent, state.input.key, null),
  );
  if (stored.taskId !== runtime.taskId)
    return yield* Effect.die(
      new Error(`Nested call ${outcome.call.id} is not in its caller's index`),
    );
  stored.result = nested as unknown as Draft<JsonRepresentation<NestedToolExecutionResult>>;
  const slot = state.slot;
  if (slot !== undefined && "parentTaskId" in slot) {
    finishSlot(slot);
    slot.summary = summaryOf(nested, outcome.result.output ?? []);
  }
  return { kind: "nested" } satisfies ToolTaskResult;
});

const settleModelCall = Effect.fnUntraced(function* (
  tx: Tx,
  runtime: ToolRuntime,
  slot: SlotOf,
  outcome: {
    readonly call: ToolHookCall;
    readonly result: ToolExecutionResult;
    readonly ending: Ending;
    readonly durationMs: number | undefined;
  },
) {
  const entry = yield* appendToolResult(tx, runtime.conversationId, outcome.call, outcome.result, {
    timestamp: runtime.now(),
    durationMs: outcome.durationMs,
  });
  if (slot !== undefined && !("parentTaskId" in slot)) {
    finishSlot(slot);
    slot.entry = entry.id;
  }
  const control =
    outcome.result.control === undefined || outcome.ending.status !== "completed"
      ? {}
      : {
          control: copyJson(outcome.result.control as JsonValue, {
            omitUndefinedProperties: true,
          }) as ToolControl,
        };
  return { kind: "model", entryId: entry.id, ...control } satisfies ToolTaskResult;
});

const terminalOf = (ending: Ending, settled: ToolTaskResult) => {
  if (ending.status === "aborted")
    return { status: "terminal", outcome: { status: "aborted", result: settled } } as const;
  if (ending.status === "failed")
    return {
      status: "terminal",
      outcome: { status: "failed", error: { message: ending.message }, result: settled },
    } as const;
  return { status: "terminal", outcome: { status: "completed", result: settled } } as const;
};

export const settle = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  input: ToolTaskInput,
  call: ToolHookCall,
  ending: Ending,
  build: (slot: SlotOf) => ToolExecutionResult,
  context: Context,
  durationMs?: number,
) {
  const madeNested = yield* abortNested(runtime, context);
  yield* commitTask(
    runtime,
    (tx: Tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        const slot = toolSlot(live, runtime.taskId);
        const result = build(slot);
        const settled =
          input.kind === "nested"
            ? yield* settleNested(tx, runtime, { input, slot }, { call, result, durationMs })
            : yield* settleModelCall(tx, runtime, slot, { call, result, ending, durationMs });
        if (madeNested) removeNestedSlots(live, runtime.taskId);
        return terminalOf(ending, settled);
      }),
    context,
  );
});
