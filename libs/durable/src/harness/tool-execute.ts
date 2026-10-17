import type { Context } from "@msa/chord";
import type { OutputLimits } from "@msa/chord/output";
import { Cause, Effect, Exit } from "effect";

import { errorMessage } from "../errors.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../truncate.ts";
import { toolDiagnostic } from "./tool-result.ts";
import { COMPLETED, type Ending, type ToolRuntime } from "./tool-types.ts";
import type {
  JsonObject,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolHookCall,
  ToolRegistration,
} from "./types.ts";

export const limitsOf = (tool: ToolRegistration): OutputLimits => ({
  maxBytes: tool.outputLimits?.maxBytes ?? DEFAULT_MAX_BYTES,
  maxLines: tool.outputLimits?.maxLines ?? DEFAULT_MAX_LINES,
  retain: tool.outputLimits?.retain ?? "head",
});

type Executed =
  | {
      readonly kind: "settled";
      readonly result: ToolExecutionResult;
      readonly ending: Ending;
      readonly durationMs: number | undefined;
    }
  | { readonly kind: "aborted"; readonly error: unknown };

const invoke = Effect.fn("invokeTool")(function* (
  runtime: ToolRuntime,
  tool: ToolRegistration,
  args: JsonObject,
  api: Omit<ToolExecutionApi, "env">,
  context: Context,
) {
  const env = yield* Effect.promise(() => runtime.env(context));
  const startedAt = performance.now();
  const exit = yield* Effect.exit(
    Effect.promise(() => Promise.resolve(tool.execute(args, { ...api, env }, context))),
  );
  return { exit, durationMs: Math.round(performance.now() - startedAt) };
});

const failed = (
  runtime: ToolRuntime,
  call: ToolHookCall,
  error: unknown,
  durationMs: number | undefined,
): Executed =>
  runtime.signal.aborted
    ? { kind: "aborted", error }
    : {
        kind: "settled",
        result: { isError: true, diagnostics: [toolDiagnostic("tool_error", errorMessage(error))] },
        ending: { status: "failed", message: `Tool ${call.name} threw` },
        durationMs,
      };

export const execute = Effect.fn("executeTool")(function* (
  runtime: ToolRuntime,
  call: ToolHookCall,
  tool: ToolRegistration,
  args: JsonObject,
  api: Omit<ToolExecutionApi, "env">,
  context: Context,
) {
  const invoked = yield* Effect.exit(invoke(runtime, tool, args, api, context));
  if (Exit.isFailure(invoked)) return failed(runtime, call, Cause.squash(invoked.cause), undefined);
  const { exit, durationMs } = invoked.value;
  if (Exit.isFailure(exit)) return failed(runtime, call, Cause.squash(exit.cause), durationMs);
  return yield* Effect.succeed<Executed>({
    kind: "settled",
    result: exit.value,
    ending: COMPLETED,
    durationMs,
  });
});
