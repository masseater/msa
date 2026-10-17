import type { ImageContent, TextContent, ToolCall, ToolResultMessage } from "@msa/ai";
import { copyJson, type JsonValue } from "@msa/chord";
import { boundOutput, type OutputLimits } from "@msa/chord/output";
import { Effect, Function } from "effect";

import { ToolResultEntry } from "../entries.ts";
import type { NestedToolSlot, NestedToolSummary, ToolSlot } from "./live.ts";
import type { Content, ToolTaskResult } from "./tool-types.ts";
import type {
  ConversationId,
  Dual2,
  Dual3,
  Dual5,
  NestedToolExecutionResult,
  TaskId,
  TaskOutcome,
  ToolDiagnostic,
  ToolExecutionResult,
  Tx,
  TypedEntry,
} from "./types.ts";
import { recordUsage } from "./usage.ts";

export const harnessError: Dual2<string, string, ToolExecutionResult> = Function.dual(
  2,
  (code: string, message: string): ToolExecutionResult => ({
    output: [],
    isError: true,
    diagnostics: [toolDiagnostic(code, message)],
  }),
);

export const toolDiagnostic: Dual2<string, string, ToolDiagnostic> = Function.dual(
  2,
  (code: string, message: string): ToolDiagnostic => ({ severity: "error", code, message }),
);

export function invalid(message: string): ToolExecutionResult {
  return harnessError("invalid_arguments", message);
}

export const truncated: Dual2<
  { readonly droppedLines: number; readonly droppedBytes: number },
  "head" | "tail" | undefined,
  ToolDiagnostic
> = Function.dual(
  2,
  (
    dropped: { readonly droppedLines: number; readonly droppedBytes: number },
    retain: "head" | "tail" | undefined,
  ): ToolDiagnostic => {
    const kept = retain === undefined ? "" : ` to its ${retain === "head" ? "beginning" : "end"}`;
    return {
      severity: "warn",
      code: "truncated",
      message: `Output truncated${kept}: ${dropped.droppedLines} lines, ${dropped.droppedBytes} bytes dropped`,
    };
  },
);

export const appendToolResult: Dual5<
  Tx,
  ConversationId,
  ToolCall,
  ToolExecutionResult,
  { readonly timestamp: number; readonly durationMs?: number | undefined },
  Effect.Effect<TypedEntry<{ diagnostics: ToolDiagnostic[] }>>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    tx: Tx,
    conversationId: ConversationId,
    call: ToolCall,
    result: ToolExecutionResult,
    meta: { readonly timestamp: number; readonly durationMs?: number | undefined },
  ) {
    const { timestamp, durationMs } = meta;
    const diagnostics = [...(result.diagnostics ?? [])];
    const content: Content = [...(result.output ?? [])];
    if (diagnostics.length > 0)
      content.push({ type: "text", text: renderDiagnostics(diagnostics) });
    const message = {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content,
      ...(result.details === undefined ? {} : { details: result.details }),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      isError: result.isError ?? false,
      ...(durationMs === undefined ? {} : { durationMs }),
      timestamp,
    } as ToolResultMessage;
    if (result.usage !== undefined)
      yield* recordUsage(tx, conversationId, "tools", call.name, result.usage);
    return yield* Effect.promise(() =>
      tx.appendEntry(ToolResultEntry, conversationId, { model: [message], data: { diagnostics } }),
    );
  }),
);

function renderDiagnostics(diagnostics: readonly ToolDiagnostic[]): string {
  return `<harness>\n${diagnostics.map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.message}`).join("\n")}\n</harness>`;
}

export const boundContent: Dual2<
  Content,
  OutputLimits,
  { content: Content; droppedBytes: number; droppedLines: number }
> = Function.dual(
  2,
  (
    content: Content,
    limits: OutputLimits,
  ): { content: Content; droppedBytes: number; droppedLines: number } => {
    const texts = content.filter((item): item is TextContent => item.type === "text");
    const bounded = boundOutput(texts.map((item) => item.text).join(""), limits);
    if (bounded.droppedBytes === 0) return { content, droppedBytes: 0, droppedLines: 0 };
    const keep = limits.retain === "head" ? texts[0] : texts.at(-1);
    const result: Content = [];
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

export function outputValue(output: Content): string | ImageContent | Content {
  if (output.length === 0) return "";
  if (output.length > 1) return output;
  const [only] = output;
  return only!.type === "text" ? only!.text : only!;
}

export const fallbackResult: Dual3<
  TaskId,
  string,
  TaskOutcome<ToolTaskResult>,
  NestedToolExecutionResult
> = Function.dual(
  3,
  (
    taskId: TaskId,
    name: string,
    outcome: TaskOutcome<ToolTaskResult>,
  ): NestedToolExecutionResult => {
    const message =
      outcome.status === "faulted"
        ? `Tool ${name} failed: ${outcome.error.message}`
        : outcome.status === "orphaned"
          ? `Tool ${name} could not resume: ${outcome.reason}`
          : `Tool ${name} ended without a result`;
    const error = harnessError(outcome.status, message);
    return { taskId, isError: true, diagnostics: error.diagnostics ?? [] };
  },
);

export const fromSlot: Dual3<
  Readonly<ToolSlot | NestedToolSlot> | undefined,
  string,
  string,
  ToolExecutionResult
> = Function.dual(
  3,
  (
    slot: Readonly<ToolSlot | NestedToolSlot> | undefined,
    code: string,
    message: string,
  ): ToolExecutionResult => {
    const diagnostics = [...(slot?.diagnostics ?? [])];
    const droppedBytes = slot?.droppedBytes ?? 0;
    if (droppedBytes > 0)
      diagnostics.push(
        truncated({ droppedBytes, droppedLines: slot?.droppedLines ?? 0 }, undefined),
      );
    diagnostics.push(toolDiagnostic(code, message));
    return {
      output:
        slot?.output === undefined || slot.output === ""
          ? []
          : [{ type: "text", text: slot.output }],
      isError: true,
      ...(slot?.details === undefined ? {} : { details: slot.details }),
      diagnostics,
    };
  },
);

export const nestedResult: Dual3<
  TaskId,
  ToolExecutionResult,
  number | undefined,
  NestedToolExecutionResult
> = Function.dual(
  3,
  (
    taskId: TaskId,
    result: ToolExecutionResult,
    durationMs: number | undefined,
  ): NestedToolExecutionResult => {
    const nested = {
      taskId,
      structuredOutput: result.structuredOutput,
      isError: result.isError ?? false,
      details: result.details,
      diagnostics: result.diagnostics ?? [],
      usage: result.usage,
      durationMs,
    };
    return copyJson(nested as unknown as JsonValue, {
      omitUndefinedProperties: true,
    }) as unknown as NestedToolExecutionResult;
  },
);

const MAX_SUMMARY_ERROR_CHARS = 500;

export const summaryOf: Dual2<NestedToolExecutionResult, Content, NestedToolSummary> =
  Function.dual(2, (result: NestedToolExecutionResult, output: Content): NestedToolSummary => {
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
              NestedToolSummary["usage"]
            >,
          }),
      ...(error === "" ? {} : { error }),
    };
  });

function errorTextOf(result: NestedToolExecutionResult, output: Content): string {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) return errors.map((diagnostic) => diagnostic.message).join("\n");
  return output.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}
