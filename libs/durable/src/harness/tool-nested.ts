import type { ToolCall } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import json from "@msa/chord/json";
import { Effect } from "effect";

import liveKit from "./live-kit.ts";
import toolCall from "./tool-call.ts";
import type toolNestedTypes from "./tool-nested.types.ts";
import toolTypes from "./tool-types.ts";
import tool from "./tool.ts";
import type typesModule from "./types.types.ts";

const { copyJson } = json;

const { bridge, live: liveModule } = liveKit;

const { jsonEqual } = toolCall;
const { LiveDoc } = liveModule;
const { commitTask } = bridge;
const { NestedCallDoc } = toolTypes;

const reuseExisting = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  existing: typesModule.TaskId<toolNestedTypes.ToolTaskResult>,
  call: ToolCall,
  name: string,
) {
  const record = yield* Effect.promise(() => tx.task(existing));
  const input = record?.input as toolNestedTypes.ToolTaskInput | undefined;
  const same =
    input?.kind === "nested" &&
    input.call.name === name &&
    jsonEqual(input.call.arguments as chordTypes.JsonValue, call.arguments as chordTypes.JsonValue);
  if (!same)
    return yield* Effect.die(
      new Error(`Nested call ${call.id} was already made with another tool or other arguments`),
    );
  return existing;
});

const createNested = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  runtime: toolNestedTypes.ToolRuntime,
  call: ToolCall,
  input: {
    readonly parentCallId: string;
    readonly name: string;
    readonly options: toolNestedTypes.NestedOptions;
  },
) {
  const { parentCallId, name, options } = input;
  const taskInput: toolNestedTypes.ToolTaskInput = {
    call,
    key: options.key,
    kind: "nested",
    parent: runtime.taskId,
    parentCallId,
    ...(options.progress === false ? { progress: false } : {}),
  };
  const created = yield* Effect.promise(() =>
    tx.createTask(tool.ToolTask, taskInput, {
      abandonOnRestart: options.abandonOnRestart,
      ownership: { kind: "task", taskId: runtime.taskId },
    }),
  );
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
  live.nestedTools ??= [];
  const slot: toolNestedTypes.NestedToolSlot = {
    arguments: call.arguments as typesModule.JsonObject,
    callId: call.id,
    name,
    parentCallId,
    parentTaskId: runtime.taskId,
    status: "pending",
    taskId: created,
  };
  live.nestedTools.push(slot as chordTypes.Draft<toolNestedTypes.NestedToolSlot>);
  return created;
});

const startNestedCall = Effect.fnUntraced(function* (
  runtime: toolNestedTypes.ToolRuntime,
  parentCallId: string,
  name: string,
  args: typesModule.JsonObject,
  options: toolNestedTypes.NestedOptions,
  context: chordTypes.Context,
) {
  const call: ToolCall = {
    arguments: copyJson(args, { omitUndefinedProperties: true }) as typesModule.JsonObject,
    id: `${parentCallId}/${options.key}`,
    name,
    type: "toolCall",
  };
  let id: typesModule.TaskId<toolNestedTypes.ToolTaskResult> | undefined;
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx) =>
      Effect.gen(function* () {
        const state = yield* Effect.promise(() =>
          tx.doc(NestedCallDoc, runtime.taskId, options.key, null),
        );
        const existing = state.taskId;
        if (existing !== undefined) {
          id = yield* reuseExisting(tx, existing, call, name);
          return undefined;
        }
        const created = yield* createNested(tx, runtime, call, { name, options, parentCallId });
        state.taskId = created;
        id = created;
        return undefined;
      }),
    context,
  );
  return id!;
});

const toolNested = {
  startNestedCall,
};

export default toolNested;
