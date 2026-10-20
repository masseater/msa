import type { Context } from "@msa/chord";
import { OutputBuffer } from "@msa/chord/output";
import { Cause, Effect } from "effect";

import toolApi from "./tool-api.ts";
import toolExecute from "./tool-execute.ts";
import toolFinal from "./tool-final.ts";
import toolProgress from "./tool-progress.ts";
import toolSettle from "./tool-settle.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";

const { execute, limitsOf } = toolExecute;
const { publishProgress } = toolProgress;
const { finalResult } = toolFinal;
const { settle } = toolSettle;

const run = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  input: toolTypesModule.ToolTaskInput,
  call: typesModule.ToolHookCall,
  tool: typesModule.ToolRegistration,
  args: typesModule.JsonObject,
  context: Context,
) {
  const limits = limitsOf(tool);
  const reported: toolTypesModule.Reported = {
    details: undefined,
    diagnostics: [],
    limits,
    output: new OutputBuffer(limits),
  };
  const streams = input.kind === "model" || input.progress !== false;
  const progress = publishProgress(runtime, reported, streams, context);
  const state = toolApi.newApiState();
  const resumes = tool.replay === "safe";
  const api = toolApi.buildApi({ call, progress, reported, resumes, runtime, state });
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

const toolRun = {
  run,
};

export default toolRun;
