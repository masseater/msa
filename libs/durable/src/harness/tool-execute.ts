import type { Context } from "@msa/chord";
import type { OutputLimits } from "@msa/chord/output";
import { Cause, Effect, Exit } from "effect";

import errors from "../errors.ts";
import truncate from "../truncate.ts";
import toolResult from "./tool-result.ts";
import toolTypes from "./tool-types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";

const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } = truncate;
const { toolDiagnostic } = toolResult;
const { errorMessage } = errors;
const { COMPLETED } = toolTypes;

const limitsOf = (tool: typesModule.ToolRegistration): OutputLimits => ({
  maxBytes: tool.outputLimits?.maxBytes ?? DEFAULT_MAX_BYTES,
  maxLines: tool.outputLimits?.maxLines ?? DEFAULT_MAX_LINES,
  retain: tool.outputLimits?.retain ?? "head",
});

type Executed =
  | {
      readonly kind: "settled";
      readonly result: typesModule.ToolExecutionResult;
      readonly ending: toolTypesModule.Ending;
      readonly durationMs: number | undefined;
    }
  | { readonly kind: "aborted"; readonly error: unknown };

const invoke = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  tool: typesModule.ToolRegistration,
  args: typesModule.JsonObject,
  api: Omit<typesModule.ToolExecutionApi, "env">,
  context: Context,
) {
  const env = yield* Effect.promise(() => runtime.env(context));
  const startedAt = performance.now();
  const exit = yield* Effect.exit(
    Effect.promise(() => Promise.resolve(tool.execute(args, { ...api, env }, context))),
  );
  return { durationMs: Math.round(performance.now() - startedAt), exit };
});

const failed = (
  runtime: toolTypesModule.ToolRuntime,
  call: typesModule.ToolHookCall,
  error: unknown,
  durationMs: number | undefined,
): Executed =>
  runtime.signal.aborted
    ? { error, kind: "aborted" }
    : {
        durationMs,
        ending: { message: `Tool ${call.name} threw`, status: "failed" },
        kind: "settled",
        result: { diagnostics: [toolDiagnostic("tool_error", errorMessage(error))], isError: true },
      };

const execute = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  call: typesModule.ToolHookCall,
  tool: typesModule.ToolRegistration,
  args: typesModule.JsonObject,
  api: Omit<typesModule.ToolExecutionApi, "env">,
  context: Context,
) {
  const invoked = yield* Effect.exit(invoke(runtime, tool, args, api, context));
  if (Exit.isFailure(invoked)) return failed(runtime, call, Cause.squash(invoked.cause), undefined);
  const { exit, durationMs } = invoked.value;
  if (Exit.isFailure(exit)) return failed(runtime, call, Cause.squash(exit.cause), durationMs);
  return yield* Effect.succeed<Executed>({
    durationMs,
    ending: COMPLETED,
    kind: "settled",
    result: exit.value,
  });
});

const toolExecute = {
  execute,
  limitsOf,
};

export default toolExecute;
