import type portableTypes from "@msa/codemode/portable.types";
import { Effect } from "effect";

import clockModule from "../clock.ts";
import tool from "../harness/tool.ts";
import type toolTypes from "../harness/tool.types.ts";
import callRows from "./call-outcome.ts";
import runCalls from "./run-calls.ts";
import type runCallsTypes from "./run-calls.types.ts";
import type runDocsTypes from "./run-docs.types.ts";

const { NestedCallDoc } = tool;
const { madeCall, sameJson } = callRows;
const { callGlobal, callTool } = runCalls;
const { currentTimeMillis } = clockModule;

type Global = NonNullable<runDocsTypes.JournalEntry["global"]>;

const priorCall = Effect.fnUntraced(function* (
  host: runCallsTypes.CallHost,
  call: portableTypes.CodemodeHostCall,
) {
  const { api, context } = host;
  const nested = yield* Effect.promise(() =>
    api.snapshot(NestedCallDoc, api.taskId, `c${call.id}`, context),
  );
  const taskId = nested?.taskId;
  if (taskId === undefined) return undefined;
  const task = yield* Effect.promise(() => api.getTask(taskId, context));
  const input = task?.input as toolTypes.ToolTaskInput | undefined;
  if (input?.kind !== "nested") return undefined;
  const made = input.call;
  if (
    call.target === "tool" &&
    made.name === call.name &&
    sameJson(made.arguments, call.args ?? {})
  )
    return undefined;
  return madeCall(made.name, made.arguments);
});

const settleCall = Effect.fnUntraced(function* (
  host: runCallsTypes.CallHost,
  call: portableTypes.CodemodeHostCall,
) {
  if (call.target === "tool") {
    const outcome = yield* callTool(host, call);
    const settled: runDocsTypes.Settled = { at: currentTimeMillis(), id: call.id, outcome };
    return settled;
  }
  const outcome = yield* callGlobal(host, call);
  const settled: runDocsTypes.Settled = {
    at: currentTimeMillis(),
    global: {
      name: call.name,
      ...(call.args === undefined ? {} : { args: call.args as NonNullable<Global["args"]> }),
      outcome: outcome as Global["outcome"],
    },
    id: call.id,
    outcome,
  };
  return settled;
});

const journalCalls = {
  priorCall,
  settleCall,
};

export default journalCalls;
