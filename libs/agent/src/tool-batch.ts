import type { AssistantMessage, ToolResultMessage } from "@msa/ai";
import { Effect } from "effect";

import { now } from "./call.ts";
import {
  createErrorToolResult,
  executeAndFinalize,
  prepareToolCall,
  type ToolCallSite,
  type ToolUpdateSink,
} from "./tool-call.ts";
import type {
  AgentEvent,
  AgentToolCall,
  AgentToolCallOutcome,
  ToolExecutionMode,
} from "./types.ts";

export type Emit = (event: AgentEvent) => Effect.Effect<void>;

export type ExecutedToolCallBatch = {
  messages: ToolResultMessage[];
  terminate: boolean;
};

export interface ToolBatch extends ToolCallSite {
  readonly toolCalls: AgentToolCall[];
  readonly emit: Emit;
}

const shouldTerminate = (finalizedCalls: readonly AgentToolCallOutcome[]): boolean =>
  finalizedCalls.length > 0 &&
  finalizedCalls.every((finalized) => finalized.result.terminate === true);

const toolExecutionStart = (toolCall: AgentToolCall): AgentEvent => ({
  type: "tool_execution_start",
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  args: toolCall.arguments,
});

const toolUpdates =
  (toolCall: AgentToolCall, emit: Emit): ToolUpdateSink =>
  (partialResult) =>
    Effect.runPromise(
      emit({
        type: "tool_execution_update",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments,
        partialResult,
      }),
    );

const emitToolExecutionEnd = (finalized: AgentToolCallOutcome, emit: Emit): Effect.Effect<void> =>
  emit({
    type: "tool_execution_end",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError,
    ...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
  });

const createToolResultMessage = (finalized: AgentToolCallOutcome): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: finalized.toolCall.id,
  toolName: finalized.toolCall.name,
  content: finalized.result.content ?? [],
  details: finalized.result.details,
  ...(finalized.result.usage === undefined ? {} : { usage: finalized.result.usage }),
  isError: finalized.isError,
  ...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
  timestamp: now(),
});

const emitToolResultMessage = (finalized: AgentToolCallOutcome, emit: Emit) =>
  Effect.gen(function* () {
    const message = createToolResultMessage(finalized);
    yield* emit({ type: "message_start", message });
    yield* emit({ type: "message_end", message });
    return message;
  });

export interface TruncatedToolCalls {
  readonly toolCalls: AgentToolCall[];
  readonly emit: Emit;
}

export const failToolCallsFromTruncatedMessage = ({
  toolCalls,
  emit,
}: TruncatedToolCalls): Effect.Effect<ExecutedToolCallBatch> =>
  Effect.gen(function* () {
    const messages: ToolResultMessage[] = [];
    for (const toolCall of toolCalls) {
      yield* emit(toolExecutionStart(toolCall));
      const finalized: AgentToolCallOutcome = {
        toolCall,
        result: createErrorToolResult(
          `Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
        ),
        isError: true,
      };
      yield* emitToolExecutionEnd(finalized, emit);
      messages.push(yield* emitToolResultMessage(finalized, emit));
    }
    return { messages, terminate: false };
  });

const finalizeOne = (batch: ToolBatch, toolCall: AgentToolCall) =>
  Effect.gen(function* () {
    yield* batch.emit(toolExecutionStart(toolCall));
    const preparation = yield* prepareToolCall({ ...batch, toolCall });
    if (preparation.kind === "immediate") {
      return {
        immediate: true,
        finalized: { toolCall, result: preparation.result, isError: preparation.isError },
      } as const;
    }
    return {
      immediate: false,
      run: executeAndFinalize({
        ...batch,
        prepared: preparation,
        onUpdate: toolUpdates(toolCall, batch.emit),
      }),
    } as const;
  });

const executeSequential = (batch: ToolBatch): Effect.Effect<ExecutedToolCallBatch> =>
  Effect.gen(function* () {
    const finalizedCalls: AgentToolCallOutcome[] = [];
    const messages: ToolResultMessage[] = [];
    for (const toolCall of batch.toolCalls) {
      const step = yield* finalizeOne(batch, toolCall);
      const finalized = step.immediate ? step.finalized : yield* step.run;
      yield* emitToolExecutionEnd(finalized, batch.emit);
      messages.push(yield* emitToolResultMessage(finalized, batch.emit));
      finalizedCalls.push(finalized);
      if (batch.signal?.aborted === true) break;
    }
    return { messages, terminate: shouldTerminate(finalizedCalls) };
  });

const deferredRun = (
  batch: ToolBatch,
  toolCall: AgentToolCall,
  run: Effect.Effect<AgentToolCallOutcome>,
): Effect.Effect<AgentToolCallOutcome> =>
  Effect.gen(function* () {
    const finalized: AgentToolCallOutcome =
      batch.signal?.aborted === true
        ? { toolCall, result: createErrorToolResult("Operation aborted"), isError: true }
        : yield* run;
    yield* emitToolExecutionEnd(finalized, batch.emit);
    return finalized;
  });

const executeParallel = (batch: ToolBatch): Effect.Effect<ExecutedToolCallBatch> =>
  Effect.gen(function* () {
    const entries: Effect.Effect<AgentToolCallOutcome>[] = [];
    for (const toolCall of batch.toolCalls) {
      const step = yield* finalizeOne(batch, toolCall);
      if (step.immediate) {
        yield* emitToolExecutionEnd(step.finalized, batch.emit);
        entries.push(Effect.succeed(step.finalized));
      } else {
        entries.push(deferredRun(batch, toolCall, step.run));
      }
      if (batch.signal?.aborted === true) break;
    }
    const ordered = yield* Effect.all(entries, { concurrency: "unbounded" });
    const messages: ToolResultMessage[] = [];
    for (const finalized of ordered) {
      messages.push(yield* emitToolResultMessage(finalized, batch.emit));
    }
    return { messages, terminate: shouldTerminate(ordered) };
  });

export interface ToolBatchRequest extends Omit<ToolBatch, "toolCalls"> {
  readonly assistantMessage: AssistantMessage;
  readonly toolExecution: ToolExecutionMode | undefined;
}

export const executeToolCalls = (
  request: ToolBatchRequest,
): Effect.Effect<ExecutedToolCallBatch> => {
  const toolCalls = request.assistantMessage.content.filter(
    (content): content is AgentToolCall => content.type === "toolCall",
  );
  const hasSequentialToolCall = toolCalls.some(
    (toolCall) =>
      request.context.tools?.find((tool) => tool.name === toolCall.name)?.executionMode ===
      "sequential",
  );
  const batch = { ...request, toolCalls };
  return request.toolExecution === "sequential" || hasSequentialToolCall
    ? executeSequential(batch)
    : executeParallel(batch);
};
