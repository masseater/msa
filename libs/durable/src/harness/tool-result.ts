import type { ImageContent, TextContent, ToolCall, ToolResultMessage } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import { copyJson } from "@msa/chord/json";
import { type OutputLimits, boundOutput } from "@msa/chord/output";
import { Effect, Function } from "effect";

import entries from "../entries.ts";
import type liveTypes from "./live.types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";

const { recordUsage } = usageModule;
const { ToolResultEntry } = entries;

const harnessError: typesModule.Dual2<string, string, typesModule.ToolExecutionResult> =
  Function.dual(2, (code: string, message: string): typesModule.ToolExecutionResult => ({
    diagnostics: [toolDiagnostic(code, message)],
    isError: true,
    output: [],
  }));

const toolDiagnostic: typesModule.Dual2<string, string, typesModule.ToolDiagnostic> = Function.dual(
  2,
  (code: string, message: string): typesModule.ToolDiagnostic => ({
    code,
    message,
    severity: "error",
  }),
);

function invalid(message: string): typesModule.ToolExecutionResult {
  return harnessError("invalid_arguments", message);
}

const truncated: typesModule.Dual2<
  { readonly droppedLines: number; readonly droppedBytes: number },
  "head" | "tail" | undefined,
  typesModule.ToolDiagnostic
> = Function.dual(
  2,
  (
    dropped: { readonly droppedLines: number; readonly droppedBytes: number },
    retain: "head" | "tail" | undefined,
  ): typesModule.ToolDiagnostic => {
    const kept = retain === undefined ? "" : ` to its ${retain === "head" ? "beginning" : "end"}`;
    return {
      code: "truncated",
      message: `Output truncated${kept}: ${dropped.droppedLines} lines, ${dropped.droppedBytes} bytes dropped`,
      severity: "warn",
    };
  },
);

const appendToolResult: typesModule.Dual5<
  typesModule.Tx,
  typesModule.ConversationId,
  ToolCall,
  typesModule.ToolExecutionResult,
  { readonly timestamp: number; readonly durationMs?: number | undefined },
  Effect.Effect<typesModule.TypedEntry<{ diagnostics: typesModule.ToolDiagnostic[] }>>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    call: ToolCall,
    result: typesModule.ToolExecutionResult,
    meta: { readonly timestamp: number; readonly durationMs?: number | undefined },
  ) {
    const { timestamp, durationMs } = meta;
    const diagnostics = [...(result.diagnostics ?? [])];
    const content: toolTypesModule.Content = [...(result.output ?? [])];
    if (diagnostics.length > 0)
      content.push({ text: renderDiagnostics(diagnostics), type: "text" });
    const message = {
      content,
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      ...(result.details === undefined ? {} : { details: result.details }),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      isError: result.isError ?? false,
      ...(durationMs === undefined ? {} : { durationMs }),
      timestamp,
    } as ToolResultMessage;
    if (result.usage !== undefined)
      yield* recordUsage(tx, conversationId, "tools", call.name, result.usage);
    return yield* Effect.promise(() =>
      tx.appendEntry(ToolResultEntry, conversationId, { data: { diagnostics }, model: [message] }),
    );
  }),
);

function renderDiagnostics(diagnostics: readonly typesModule.ToolDiagnostic[]): string {
  return `<harness>\n${diagnostics.map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.message}`).join("\n")}\n</harness>`;
}

const boundContent: typesModule.Dual2<
  toolTypesModule.Content,
  OutputLimits,
  { content: toolTypesModule.Content; droppedBytes: number; droppedLines: number }
> = Function.dual(
  2,
  (
    content: toolTypesModule.Content,
    limits: OutputLimits,
  ): { content: toolTypesModule.Content; droppedBytes: number; droppedLines: number } => {
    const texts = content.filter((item): item is TextContent => item.type === "text");
    const bounded = boundOutput(texts.map((item) => item.text).join(""), limits);
    if (bounded.droppedBytes === 0) return { content, droppedBytes: 0, droppedLines: 0 };
    const keep = limits.retain === "head" ? texts[0] : texts.at(-1);
    const result: toolTypesModule.Content = [];
    for (const item of content) {
      if (item.type !== "text") result.push(item);
      else if (item === keep) result.push({ ...item, text: bounded.text });
    }
    return {
      content: result,
      droppedBytes: bounded.droppedBytes,
      droppedLines: bounded.droppedLines,
    };
  },
);

function outputValue(
  output: toolTypesModule.Content,
): string | ImageContent | toolTypesModule.Content {
  if (output.length === 0) return "";
  if (output.length > 1) return output;
  const [only] = output;
  return only!.type === "text" ? only!.text : only!;
}

const fallbackResult: typesModule.Dual3<
  typesModule.TaskId,
  string,
  typesModule.TaskOutcome<toolTypesModule.ToolTaskResult>,
  typesModule.NestedToolExecutionResult
> = Function.dual(
  3,
  (
    taskId: typesModule.TaskId,
    name: string,
    outcome: typesModule.TaskOutcome<toolTypesModule.ToolTaskResult>,
  ): typesModule.NestedToolExecutionResult => {
    const message =
      outcome.status === "faulted"
        ? `Tool ${name} failed: ${outcome.error.message}`
        : outcome.status === "orphaned"
          ? `Tool ${name} could not resume: ${outcome.reason}`
          : `Tool ${name} ended without a result`;
    const error = harnessError(outcome.status, message);
    return { diagnostics: error.diagnostics ?? [], isError: true, taskId };
  },
);

const fromSlot: typesModule.Dual3<
  Readonly<liveTypes.ToolSlot | liveTypes.NestedToolSlot> | undefined,
  string,
  string,
  typesModule.ToolExecutionResult
> = Function.dual(
  3,
  (
    slot: Readonly<liveTypes.ToolSlot | liveTypes.NestedToolSlot> | undefined,
    code: string,
    message: string,
  ): typesModule.ToolExecutionResult => {
    const diagnostics = [...(slot?.diagnostics ?? [])];
    const droppedBytes = slot?.droppedBytes ?? 0;
    if (droppedBytes > 0)
      diagnostics.push(
        truncated({ droppedBytes, droppedLines: slot?.droppedLines ?? 0 }, undefined),
      );
    diagnostics.push(toolDiagnostic(code, message));
    return {
      isError: true,
      output:
        slot?.output === undefined || slot.output === ""
          ? []
          : [{ text: slot.output, type: "text" }],
      ...(slot?.details === undefined ? {} : { details: slot.details }),
      diagnostics,
    };
  },
);

const nestedResult: typesModule.Dual3<
  typesModule.TaskId,
  typesModule.ToolExecutionResult,
  number | undefined,
  typesModule.NestedToolExecutionResult
> = Function.dual(
  3,
  (
    taskId: typesModule.TaskId,
    result: typesModule.ToolExecutionResult,
    durationMs: number | undefined,
  ): typesModule.NestedToolExecutionResult => {
    const nested = {
      details: result.details,
      diagnostics: result.diagnostics ?? [],
      durationMs,
      isError: result.isError ?? false,
      structuredOutput: result.structuredOutput,
      taskId,
      usage: result.usage,
    };
    return copyJson(nested as unknown as JsonValue, {
      omitUndefinedProperties: true,
    }) as unknown as typesModule.NestedToolExecutionResult;
  },
);

const MAX_SUMMARY_ERROR_CHARS = 500;

const summaryOf: typesModule.Dual2<
  typesModule.NestedToolExecutionResult,
  toolTypesModule.Content,
  liveTypes.NestedToolSummary
> = Function.dual(
  2,
  (
    result: typesModule.NestedToolExecutionResult,
    output: toolTypesModule.Content,
  ): liveTypes.NestedToolSummary => {
    const error = result.isError
      ? errorTextOf(result, output).slice(0, MAX_SUMMARY_ERROR_CHARS)
      : "";
    return {
      isError: result.isError,
      ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
      ...(result.usage === undefined
        ? {}
        : {
            usage: copyJson(result.usage, { omitUndefinedProperties: true }) as NonNullable<
              liveTypes.NestedToolSummary["usage"]
            >,
          }),
      ...(error === "" ? {} : { error }),
    };
  },
);

function errorTextOf(
  result: typesModule.NestedToolExecutionResult,
  output: toolTypesModule.Content,
): string {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) return errors.map((diagnostic) => diagnostic.message).join("\n");
  return output.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

const toolResult = {
  appendToolResult,
  boundContent,
  fallbackResult,
  fromSlot,
  harnessError,
  invalid,
  nestedResult,
  outputValue,
  summaryOf,
  toolDiagnostic,
  truncated,
};

export default toolResult;
