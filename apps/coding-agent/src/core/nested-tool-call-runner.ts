import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import NestedCallRecorder from "./nested-call-recorder.ts";
import type nestedToolCallsTypes from "./nested-tool-calls.types.ts";
import platform from "./platform.ts";
const { awaited, awaitingWith } = awaitingModule;
const { makeLatch } = platform;

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
export default class NestedToolCallRunner {
  private readonly host: nestedToolCallsTypes.NestedToolCallHost;
  private readonly scopes = new Map<string, CallScope>();
  private queueTail: Promise<void> = Promise.resolve();

  constructor(host: nestedToolCallsTypes.NestedToolCallHost) {
    this.host = host;
  }

  execute(
    callerId: string,
    name: string,
    args: unknown,
    options: nestedToolCallsTypes.NestedToolCallOptions = {},
  ): Promise<agentTypes.AgentToolCallOutcome> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let scope = this.scopes.get(callerId);
        let toolCall: agentTypes.AgentToolCall | undefined;
        let release: (() => void) | undefined;
        let record;
        ({ toolCall, release, record, scope } = yield* this.executePart1(
          scope,
          callerId,
          args,
          name,
        ));
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
            isError: outcome.isError,
            result: outcome.result,
            toolCallId: toolCall.id,
            toolName: name,
            type: "tool_execution_end",
            ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
            parentToolCallId: callerId,
          }),
        );
        return outcome;
      }, this),
    );
  }

  private *executePart1(
    scope: CallScope | undefined,
    callerId: string,
    args: unknown,
    name: string,
  ) {
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
        this.host.getTools().find((tool) => tool.name === name)?.executionMode === "sequential");
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
    return { record, release, scope, toolCall };
  }

  takeRecord(toolCallId: string): nestedToolCallsTypes.NestedCallSummary | undefined {
    const scope = this.scopes.get(toolCallId);
    this.scopes.delete(toolCallId);
    if (scope === undefined) return undefined;
    return { calls: scope.recorder.snapshot(), usage: scope.recorder.totalUsage };
  }

  clear(): void {
    this.scopes.clear();
  }
}
