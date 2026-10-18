import type { ToolCall } from "@msa/ai";
import type { Context, Draft, JsonValue } from "@msa/chord";
import { copyJson } from "@msa/chord/json";
import { Effect } from "effect";

import { commitTask } from "./bridge.ts";
import { LiveDoc, type NestedToolSlot } from "./live.ts";
import { jsonEqual } from "./tool-call.ts";
import {
  NestedCallDoc,
  type ToolRuntime,
  type ToolTaskInput,
  type ToolTaskResult,
} from "./tool-types.ts";
import { ToolTask } from "./tool.ts";
import type { JsonObject, TaskId, Tx } from "./types.ts";

export type NestedOptions = {
  readonly key: string;
  readonly progress: boolean | undefined;
  readonly abandonOnRestart: boolean;
};

const reuseExisting = Effect.fnUntraced(function* (
  tx: Tx,
  existing: TaskId<ToolTaskResult>,
  call: ToolCall,
  name: string,
) {
  const record = yield* Effect.promise(() => tx.task(existing));
  const input = record?.input as ToolTaskInput | undefined;
  const same =
    input?.kind === "nested" &&
    input.call.name === name &&
    jsonEqual(input.call.arguments as JsonValue, call.arguments as JsonValue);
  if (!same)
    return yield* Effect.die(
      new Error(`Nested call ${call.id} was already made with another tool or other arguments`),
    );
  return existing;
});

const createNested = Effect.fnUntraced(function* (
  tx: Tx,
  runtime: ToolRuntime,
  call: ToolCall,
  input: { readonly parentCallId: string; readonly name: string; readonly options: NestedOptions },
) {
  const { parentCallId, name, options } = input;
  const taskInput: ToolTaskInput = {
    kind: "nested",
    parent: runtime.taskId,
    parentCallId,
    key: options.key,
    call,
    ...(options.progress === false ? { progress: false } : {}),
  };
  const created = yield* Effect.promise(() =>
    tx.createTask(ToolTask, taskInput, {
      ownership: { kind: "task", taskId: runtime.taskId },
      abandonOnRestart: options.abandonOnRestart,
    }),
  );
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
  live.nestedTools ??= [];
  const slot: NestedToolSlot = {
    callId: call.id,
    parentCallId,
    parentTaskId: runtime.taskId,
    name,
    taskId: created,
    arguments: call.arguments as JsonObject,
    status: "pending",
  };
  live.nestedTools.push(slot as Draft<NestedToolSlot>);
  return created;
});

export const startNestedCall = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  parentCallId: string,
  name: string,
  args: JsonObject,
  options: NestedOptions,
  context: Context,
) {
  const call: ToolCall = {
    type: "toolCall",
    id: `${parentCallId}/${options.key}`,
    name,
    arguments: copyJson(args, { omitUndefinedProperties: true }) as JsonObject,
  };
  let id: TaskId<ToolTaskResult> | undefined;
  yield* commitTask(
    runtime,
    (tx: Tx) =>
      Effect.gen(function* () {
        const state = yield* Effect.promise(() =>
          tx.doc(NestedCallDoc, runtime.taskId, options.key, null),
        );
        const existing = state.taskId;
        if (existing !== undefined) {
          id = yield* reuseExisting(tx, existing, call, name);
          return undefined;
        }
        const created = yield* createNested(tx, runtime, call, { parentCallId, name, options });
        state.taskId = created;
        id = created;
        return undefined;
      }),
    context,
  );
  return id!;
});
