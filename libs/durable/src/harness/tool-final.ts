import type { Context, JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { Compile } from "typebox/compile";

import { eachHook, hookResult } from "./bridge.ts";
import { boundContent, outputValue, toolDiagnostic, truncated } from "./tool-result.ts";
import type { Content, Reported, ToolRuntime, ToolTaskInput } from "./tool-types.ts";
import type {
  ToolDiagnostic,
  ToolExecutionResult,
  ToolHookCall,
  ToolRegistration,
} from "./types.ts";

const structuredValidators = new WeakMap<object, ReturnType<typeof Compile>>();

function structuredOutputError(
  tool: ToolRegistration,
  result: ToolExecutionResult,
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
  readonly final: ToolExecutionResult;
  readonly output: Content;
  readonly retained: ReturnType<Reported["output"]["snapshot"]> | undefined;
};

const mergeReported = (result: ToolExecutionResult, reported: Reported): Merged => {
  const retained = result.output === undefined ? reported.output.snapshot() : undefined;
  const output: Content =
    retained === undefined
      ? result.output!
      : retained.text === ""
        ? []
        : [{ type: "text", text: retained.text }];
  const details = result.details === undefined ? reported.details : result.details;
  return {
    retained,
    output,
    final: {
      ...result,
      output,
      ...(details === undefined ? {} : { details }),
      diagnostics: [...reported.diagnostics, ...(result.diagnostics ?? [])],
    },
  };
};

const applyStructured = (
  input: ToolTaskInput,
  tool: ToolRegistration,
  final: ToolExecutionResult,
  harness: ToolDiagnostic[],
  report: (error: unknown) => void,
): ToolExecutionResult => {
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
  input: ToolTaskInput,
  tool: ToolRegistration,
  final: ToolExecutionResult,
  bounded: ReturnType<typeof boundContent>,
  harness: ToolDiagnostic[],
): ToolExecutionResult => {
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

export const finalResult = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  input: ToolTaskInput,
  call: ToolHookCall,
  tool: ToolRegistration,
  result: ToolExecutionResult,
  reported: Reported,
  context: Context,
) {
  const harness: ToolDiagnostic[] = [];
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
    output: bounded.content,
    diagnostics: [...(final.diagnostics ?? []), ...harness],
  };
});
