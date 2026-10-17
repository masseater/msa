import type { Context } from "@msa/chord";
import { OutputBuffer } from "@msa/chord/output";
import { Cause, Effect } from "effect";

import { buildApi, newApiState } from "./tool-api.ts";
import { execute, limitsOf } from "./tool-execute.ts";
import { finalResult } from "./tool-final.ts";
import { publishProgress } from "./tool-progress.ts";
import { settle } from "./tool-settle.ts";
import type { Reported, ToolRuntime, ToolTaskInput } from "./tool-types.ts";
import type { JsonObject, ToolHookCall, ToolRegistration } from "./types.ts";

export const run = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  input: ToolTaskInput,
  call: ToolHookCall,
  tool: ToolRegistration,
  args: JsonObject,
  context: Context,
) {
  const limits = limitsOf(tool);
  const reported: Reported = {
    output: new OutputBuffer(limits),
    limits,
    diagnostics: [],
    details: undefined,
  };
  const streams = input.kind === "model" || input.progress !== false;
  const progress = publishProgress(runtime, reported, streams, context);
  const state = newApiState();
  const resumes = tool.replay === "safe";
  const api = buildApi({ runtime, call, reported, progress, state, resumes });
  const executed = yield* execute(runtime, call, tool, args, api, context);
  state.ended = true;
  if (executed.kind === "aborted") {
    const waiters = yield* Effect.promise(() => progress.stop());
    for (const waiter of waiters) waiter.reject(executed.error);
    return yield* Effect.die(executed.error);
  }
  yield* Effect.promise(() => Promise.allSettled(state.admissions));
  reported.output.end();
  const pending = yield* Effect.promise(() => progress.stop());
  const settled = yield* Effect.onError(
    Effect.flatMap(
      finalResult(runtime, input, call, tool, executed.result, reported, context),
      (result) =>
        settle(runtime, input, call, executed.ending, () => result, context, executed.durationMs),
    ),
    (cause) =>
      Effect.sync(() => {
        for (const waiter of pending) waiter.reject(Cause.squash(cause));
      }),
  );
  for (const waiter of pending) waiter.resolve();
  return settled;
});
