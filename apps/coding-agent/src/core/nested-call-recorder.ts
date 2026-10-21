import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import nestedToolCalls from "./nested-tool-calls.ts";
import usageTotals from "./usage-totals.ts";

const { combineUsage } = usageTotals;
const { NESTED_CALL_LIMITS } = nestedToolCalls;

const encoder = new TextEncoder();
export default class NestedCallRecorder {
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
