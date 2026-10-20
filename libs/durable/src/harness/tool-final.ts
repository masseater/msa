import type { Context, JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { Compile } from "typebox/compile";

import bridge from "./bridge.ts";
import toolResult from "./tool-result.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";

const { boundContent, outputValue, toolDiagnostic, truncated } = toolResult;
const { eachHook, hookResult } = bridge;

const structuredValidators = new WeakMap<object, ReturnType<typeof Compile>>();

function structuredOutputError(
  tool: typesModule.ToolRegistration,
  result: typesModule.ToolExecutionResult,
): string | undefined {
  const schema = tool.structuredOutputSchema;
  const value = result.structuredOutput;
  if (schema === undefined) {
    return value === undefined
      ? undefined
      : `Tool ${tool.name} returned structuredOutput but declares no structuredOutputSchema`;
  }
  if (value === undefined) {
    return result.isError === true ? undefined : `Tool ${tool.name} returned no structuredOutput`;
  }
  let validator = structuredValidators.get(schema);
  if (validator === undefined) {
    validator = Compile(schema);
    structuredValidators.set(schema, validator);
  }
  if (validator.Check(value)) return undefined;
  const [first] = validator.Errors(value);
  const path = first?.instancePath.replace(/^\//u, "").replace(/\//gu, ".") || "root";
  return `Tool ${tool.name} returned structuredOutput that does not match its schema: ${path}: ${first?.message ?? "invalid"}`;
}

type Merged = {
  readonly final: typesModule.ToolExecutionResult;
  readonly output: toolTypesModule.Content;
  readonly retained: ReturnType<toolTypesModule.Reported["output"]["snapshot"]> | undefined;
};

const mergeReported = (
  result: typesModule.ToolExecutionResult,
  reported: toolTypesModule.Reported,
): Merged => {
  const retained = result.output === undefined ? reported.output.snapshot() : undefined;
  const output: toolTypesModule.Content =
    retained === undefined
      ? result.output!
      : retained.text === ""
        ? []
        : [{ text: retained.text, type: "text" }];
  const details = result.details === undefined ? reported.details : result.details;
  return {
    final: {
      ...result,
      output,
      ...(details === undefined ? {} : { details }),
      diagnostics: [...reported.diagnostics, ...(result.diagnostics ?? [])],
    },
    output,
    retained,
  };
};

const applyStructured = (
  input: toolTypesModule.ToolTaskInput,
  tool: typesModule.ToolRegistration,
  final: typesModule.ToolExecutionResult,
  harness: typesModule.ToolDiagnostic[],
  report: (error: unknown) => void,
): typesModule.ToolExecutionResult => {
  const broken = structuredOutputError(tool, final);
  let merged = final;
  if (broken !== undefined) {
    const { structuredOutput: _dropped, ...rest } = final;
    if (input.kind === "nested") {
      merged = { ...rest, isError: true };
      harness.push(toolDiagnostic("invalid_structured_output", broken));
    } else {
      merged = rest;
      report(new Error(broken));
    }
  }
  return merged;
};

const nestedStructured = (
  input: toolTypesModule.ToolTaskInput,
  tool: typesModule.ToolRegistration,
  final: typesModule.ToolExecutionResult,
  bounded: ReturnType<typeof boundContent>,
  harness: typesModule.ToolDiagnostic[],
): typesModule.ToolExecutionResult => {
  if (input.kind !== "nested") return final;
  if (tool.structuredOutputSchema === undefined)
    return { ...final, structuredOutput: outputValue(bounded.content) as JsonValue };
  if (
    final.isError === true &&
    final.structuredOutput === undefined &&
    ![...(final.diagnostics ?? []), ...harness].some(
      (diagnostic) => diagnostic.severity === "error",
    )
  ) {
    const text = bounded.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");
    if (text !== "") harness.push(toolDiagnostic("tool_error", text));
  }
  return final;
};

const finalResult = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  input: toolTypesModule.ToolTaskInput,
  call: typesModule.ToolHookCall,
  tool: typesModule.ToolRegistration,
  result: typesModule.ToolExecutionResult,
  reported: toolTypesModule.Reported,
  context: Context,
) {
  const harness: typesModule.ToolDiagnostic[] = [];
  const merged = mergeReported(result, reported);
  let final = merged.final;
  yield* eachHook(runtime.hooks, "afterTool", (hook) =>
    Effect.map(
      hookResult(() => hook(call, final, runtime, context)),
      (replaced) => {
        final = replaced ?? final;
      },
    ),
  );
  if (
    merged.retained !== undefined &&
    merged.retained.droppedBytes > 0 &&
    final.output === merged.output
  )
    harness.push(truncated(merged.retained, reported.limits.retain));
  const bounded = boundContent(final.output ?? [], reported.limits);
  if (bounded.droppedBytes > 0) harness.push(truncated(bounded, reported.limits.retain));
  final = applyStructured(input, tool, final, harness, (error) => {
    runtime.report(error);
  });
  final = nestedStructured(input, tool, final, bounded, harness);
  return {
    ...final,
    diagnostics: [...(final.diagnostics ?? []), ...harness],
    output: bounded.content,
  };
});

const toolFinal = {
  finalResult,
};

export default toolFinal;
