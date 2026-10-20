import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import { awaited, awaitingWith } from "./awaiting.ts";
import { makeLatch } from "./platform.ts";
import { combineUsage } from "./usage-totals.ts";

export const NESTED_CALL_LIMITS = {
  maxArgumentBytesPerCall: 8 * 1024,
  maxArgumentBytesTotal: 32 * 1024,
  maxCalls: 256,
  maxErrorChars: 500,
} as const;

const encoder = new TextEncoder();

export interface NestedCallSummary {
  calls: aiTypes.NestedToolCalls | undefined;
  usage: aiTypes.Usage | undefined;
}

export class NestedCallRecorder {
  private readonly calls: aiTypes.NestedToolCallRecord[] = [];
  private readonly startedAt = new Map<aiTypes.NestedToolCallRecord, number>();
  private complete = true;
  private argumentBytes = 0;
  private usage: aiTypes.Usage | undefined;

  start(toolCall: agentTypes.AgentToolCall): aiTypes.NestedToolCallRecord | undefined {
    if (this.calls.length >= NESTED_CALL_LIMITS.maxCalls) {
      this.complete = false;
      return undefined;
    }
    const record: aiTypes.NestedToolCallRecord = {
      id: toolCall.id,
      name: toolCall.name,
      status: "unfinished",
    };
    const json = JSON.stringify(toolCall.arguments ?? {});
    const bytes = encoder.encode(json).length;
    if (
      bytes > NESTED_CALL_LIMITS.maxArgumentBytesPerCall ||
      this.argumentBytes + bytes > NESTED_CALL_LIMITS.maxArgumentBytesTotal
    ) {
      record.argumentsBytes = bytes;
      this.complete = false;
    } else {
      record.arguments = JSON.parse(json) as aiTypes.JsonObject;
      this.argumentBytes += bytes;
    }
    this.calls.push(record);
    this.startedAt.set(record, performance.now());
    return record;
  }

  finish(
    record: aiTypes.NestedToolCallRecord | undefined,
    isError: boolean,
    errorText: string,
  ): void {
    if (record === undefined) return;
    record.status = isError ? "error" : "ok";
    record.durationMs = Math.round(
      performance.now() - (this.startedAt.get(record) ?? performance.now()),
    );
    this.startedAt.delete(record);
    if (isError && errorText !== "")
      record.error = errorText.slice(0, NESTED_CALL_LIMITS.maxErrorChars);
  }

  addUsage(usage: aiTypes.Usage): void {
    this.usage = this.usage === undefined ? usage : combineUsage(this.usage, usage);
  }

  get totalUsage(): aiTypes.Usage | undefined {
    return this.usage;
  }

  snapshot(): aiTypes.NestedToolCalls | undefined {
    if (this.calls.length === 0 && this.complete) return undefined;
    const calls = this.calls.map((call) => ({ ...call }));
    return {
      calls,
      complete: this.complete && calls.every((call) => call.status !== "unfinished"),
    };
  }
}

export interface NestedToolCallOptions {
  signal?: AbortSignal | undefined;
  onUpdate?: agentTypes.AgentToolUpdateCallback | undefined;
}

export type NestedToolExecutionEvent =
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
      parentToolCallId: string;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: agentTypes.AgentToolResult<unknown>;
      parentToolCallId: string;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: agentTypes.AgentToolResult<unknown>;
      isError: boolean;
      durationMs?: number;
      parentToolCallId: string;
    };

export interface NestedToolCallHost {
  getTools(): readonly agentTypes.AgentTool[];
  isSequential(): boolean;
  runToolCall(
    toolCall: agentTypes.AgentToolCall,
    parentToolCallId: string,
    signal: AbortSignal | undefined,
    onUpdate: (partialResult: agentTypes.AgentToolResult<unknown>) => Promise<void>,
  ): Promise<agentTypes.AgentToolCallOutcome>;
  emit(event: NestedToolExecutionEvent): Promise<void>;
}

interface CallScope {
  recorder: NestedCallRecorder;
  nextId: number;
  holdsQueue: boolean;
}

function textOf(result: agentTypes.AgentToolResult<unknown>): string {
  return (result.content ?? [])
    .filter((block): block is aiTypes.TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export class NestedToolCallRunner {
  private readonly host: NestedToolCallHost;
  private readonly scopes = new Map<string, CallScope>();
  private queueTail: Promise<void> = Promise.resolve();

  constructor(host: NestedToolCallHost) {
    this.host = host;
  }

  execute(
    callerId: string,
    name: string,
    args: unknown,
    options: NestedToolCallOptions = {},
  ): Promise<agentTypes.AgentToolCallOutcome> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let scope = this.scopes.get(callerId);
        if (scope === undefined) {
          scope = { holdsQueue: false, nextId: 1, recorder: new NestedCallRecorder() };
          this.scopes.set(callerId, scope);
        }
        const toolCall: agentTypes.AgentToolCall = {
          arguments: (args ?? {}) as agentTypes.AgentToolCall["arguments"],
          id: `${callerId}/${scope.nextId++}`,
          name,
          type: "toolCall",
        };
        const record = scope.recorder.start(toolCall);
        yield* awaited(
          this.host.emit({
            args: toolCall.arguments,
            parentToolCallId: callerId,
            toolCallId: toolCall.id,
            toolName: name,
            type: "tool_execution_start",
          }),
        );

        const exclusive =
          !scope.holdsQueue &&
          (this.host.isSequential() ||
            this.host.getTools().find((tool) => tool.name === name)?.executionMode ===
              "sequential");
        let release: (() => void) | undefined;
        if (exclusive) {
          const previous = this.queueTail;
          const latch = makeLatch();
          release = latch.open;
          this.queueTail = latch.promise;
          yield* awaited(previous);
        }
        this.scopes.set(toolCall.id, {
          holdsQueue: scope.holdsQueue || exclusive,
          nextId: 1,
          recorder: scope.recorder,
        });
        let outcome: agentTypes.AgentToolCallOutcome;
        try {
          outcome = yield* awaited(
            this.host.runToolCall(toolCall, callerId, options.signal, (partialResult) =>
              Effect.runPromise(
                awaitingWith(function* () {
                  options.onUpdate?.(partialResult);
                  yield* awaited(
                    this.host.emit({
                      args: toolCall.arguments,
                      parentToolCallId: callerId,
                      partialResult,
                      toolCallId: toolCall.id,
                      toolName: name,
                      type: "tool_execution_update",
                    }),
                  );
                }, this),
              ),
            ),
          );
        } finally {
          this.scopes.delete(toolCall.id);
          release?.();
        }

        scope.recorder.finish(record, outcome.isError, textOf(outcome.result));
        if (outcome.result.usage !== undefined) scope.recorder.addUsage(outcome.result.usage);
        yield* awaited(
          this.host.emit({
            type: "tool_execution_end",
            toolCallId: toolCall.id,
            toolName: name,
            result: outcome.result,
            isError: outcome.isError,
            ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
            parentToolCallId: callerId,
          }),
        );
        return outcome;
      }, this),
    );
  }

  takeRecord(toolCallId: string): NestedCallSummary | undefined {
    const scope = this.scopes.get(toolCallId);
    this.scopes.delete(toolCallId);
    if (scope === undefined) return undefined;
    return { calls: scope.recorder.snapshot(), usage: scope.recorder.totalUsage };
  }

  clear(): void {
    this.scopes.clear();
  }
}
