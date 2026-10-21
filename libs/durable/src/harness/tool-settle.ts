import type chordTypes from "@msa/chord/index.types";
import json from "@msa/chord/json";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import liveModule from "./live.ts";
import toolResult from "./tool-result.ts";
import toolTypes from "./tool-types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";

const { copyJson } = json;

const { LiveDoc, finishSlot, removeNestedSlots, toolSlot } = liveModule;
const { MADE_NESTED_CALLS, NestedCallDoc, TOOL_TASK_NAME } = toolTypes;
const { appendToolResult, nestedResult, summaryOf } = toolResult;
const { recordUsage } = usageModule;
const { commitTask } = bridge;

type SlotOf = ReturnType<typeof toolSlot>;

const abortNested = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  context: chordTypes.Context,
) {
  const owned = yield* Effect.promise(() => runtime.ownedTasks(context));
  const nestedIds = owned
    .filter(
      (record) =>
        record.kind === TOOL_TASK_NAME &&
        (record.input as toolTypesModule.ToolTaskInput).kind === "nested",
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
  tx: typesModule.Tx,
  runtime: toolTypesModule.ToolRuntime,
  state: {
    readonly input: Extract<toolTypesModule.ToolTaskInput, { kind: "nested" }>;
    readonly slot: SlotOf;
  },
  outcome: {
    readonly call: typesModule.ToolHookCall;
    readonly result: typesModule.ToolExecutionResult;
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
  stored.result = nested as unknown as chordTypes.Draft<
    chordTypes.JsonRepresentation<typesModule.NestedToolExecutionResult>
  >;
  const slot = state.slot;
  if (slot !== undefined && "parentTaskId" in slot) {
    finishSlot(slot);
    slot.summary = summaryOf(nested, outcome.result.output ?? []);
  }
  return { kind: "nested" } satisfies toolTypesModule.ToolTaskResult;
});

const settleModelCall = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  runtime: toolTypesModule.ToolRuntime,
  slot: SlotOf,
  outcome: {
    readonly call: typesModule.ToolHookCall;
    readonly result: typesModule.ToolExecutionResult;
    readonly ending: toolTypesModule.Ending;
    readonly durationMs: number | undefined;
  },
) {
  const entry = yield* appendToolResult(tx, runtime.conversationId, outcome.call, outcome.result, {
    durationMs: outcome.durationMs,
    timestamp: runtime.now(),
  });
  if (slot !== undefined && !("parentTaskId" in slot)) {
    finishSlot(slot);
    slot.entry = entry.id;
  }
  const control =
    outcome.result.control === undefined || outcome.ending.status !== "completed"
      ? {}
      : {
          control: copyJson(outcome.result.control as chordTypes.JsonValue, {
            omitUndefinedProperties: true,
          }) as typesModule.ToolControl,
        };
  return { entryId: entry.id, kind: "model", ...control } satisfies toolTypesModule.ToolTaskResult;
});

const terminalOf = (ending: toolTypesModule.Ending, settled: toolTypesModule.ToolTaskResult) => {
  if (ending.status === "aborted")
    return { outcome: { result: settled, status: "aborted" }, status: "terminal" } as const;
  if (ending.status === "failed")
    return {
      outcome: { error: { message: ending.message }, result: settled, status: "failed" },
      status: "terminal",
    } as const;
  return { outcome: { result: settled, status: "completed" }, status: "terminal" } as const;
};

const settle = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  input: toolTypesModule.ToolTaskInput,
  call: typesModule.ToolHookCall,
  ending: toolTypesModule.Ending,
  build: (slot: SlotOf) => typesModule.ToolExecutionResult,
  context: chordTypes.Context,
  durationMs?: number,
) {
  const madeNested = yield* abortNested(runtime, context);
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx) =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        const slot = toolSlot(live, runtime.taskId);
        const result = build(slot);
        const settled =
          input.kind === "nested"
            ? yield* settleNested(tx, runtime, { input, slot }, { call, durationMs, result })
            : yield* settleModelCall(tx, runtime, slot, { call, durationMs, ending, result });
        if (madeNested) removeNestedSlots(live, runtime.taskId);
        return terminalOf(ending, settled);
      }),
    context,
  );
});

const toolSettle = {
  settle,
};

export default toolSettle;
