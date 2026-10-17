import type { CodemodeHostCall } from "@msa/codemode/portable";
import { Effect } from "effect";

import { currentTimeMillis } from "../clock.ts";
import { NestedCallDoc, type ToolTaskInput } from "../harness/tool.ts";
import { madeCall, sameJson } from "./call-rows.ts";
import { type CallHost, callGlobal, callTool } from "./run-calls.ts";
import type { JournalEntry, Settled } from "./run-docs.ts";

type Global = NonNullable<JournalEntry["global"]>;

export const priorCall = Effect.fnUntraced(function* (host: CallHost, call: CodemodeHostCall) {
  const { api, context } = host;
  const nested = yield* Effect.promise(() =>
    api.snapshot(NestedCallDoc, api.taskId, `c${call.id}`, context),
  );
  const taskId = nested?.taskId;
  if (taskId === undefined) return undefined;
  const task = yield* Effect.promise(() => api.getTask(taskId, context));
  const input = task?.input as ToolTaskInput | undefined;
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

export const settleCall = Effect.fnUntraced(function* (host: CallHost, call: CodemodeHostCall) {
  if (call.target === "tool") {
    const outcome = yield* callTool(host, call);
    const settled: Settled = { id: call.id, at: currentTimeMillis(), outcome };
    return settled;
  }
  const outcome = yield* callGlobal(host, call);
  const settled: Settled = {
    id: call.id,
    at: currentTimeMillis(),
    outcome,
    global: {
      name: call.name,
      ...(call.args === undefined ? {} : { args: call.args as NonNullable<Global["args"]> }),
      outcome: outcome as Global["outcome"],
    },
  };
  return settled;
});
