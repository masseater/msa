import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import callModule from "./call.ts";
import type toolBatchTypes from "./tool-batch.types.ts";
import toolCallModule from "./tool-call.ts";
import type toolCallTypes from "./tool-call.types.ts";
import type typesModule from "./types.ts";

const { now } = callModule;
const { createErrorToolResult, executeAndFinalize, prepareToolCall } = toolCallModule;

const shouldTerminate = (finalizedCalls: readonly typesModule.AgentToolCallOutcome[]): boolean =>
  finalizedCalls.length > 0 &&
  finalizedCalls.every((finalized) => finalized.result.terminate === true);

const toolExecutionStart = (toolCall: typesModule.AgentToolCall): typesModule.AgentEvent => ({
  args: toolCall.arguments,
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  type: "tool_execution_start",
});

const toolUpdates =
  (toolCall: typesModule.AgentToolCall, emit: toolBatchTypes.Emit): toolCallTypes.ToolUpdateSink =>
  (partialResult) =>
    Effect.runPromise(
      emit({
        args: toolCall.arguments,
        partialResult,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        type: "tool_execution_update",
      }),
    );

const emitToolExecutionEnd = (
  finalized: typesModule.AgentToolCallOutcome,
  emit: toolBatchTypes.Emit,
): Effect.Effect<void> =>
  emit({
    isError: finalized.isError,
    result: finalized.result,
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    type: "tool_execution_end",
    ...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
  });

const createToolResultMessage = (
  finalized: typesModule.AgentToolCallOutcome,
): aiTypes.ToolResultMessage => ({
  content: finalized.result.content ?? [],
  details: finalized.result.details,
  isError: finalized.isError,
  role: "toolResult",
  timestamp: now(),
  toolCallId: finalized.toolCall.id,
  toolName: finalized.toolCall.name,
  ...(finalized.result.usage === undefined ? {} : { usage: finalized.result.usage }),
  ...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
});

const emitToolResultMessage = (
  finalized: typesModule.AgentToolCallOutcome,
  emit: toolBatchTypes.Emit,
) =>
  Effect.gen(function* () {
    const message = createToolResultMessage(finalized);
    yield* emit({ message, type: "message_start" });
    const end = { message, type: "message_end" as const };
    yield* emit(end);
    return end.message;
  });

const failToolCallsFromTruncatedMessage = ({
  toolCalls,
  emit,
}: toolBatchTypes.TruncatedToolCalls): Effect.Effect<toolBatchTypes.ExecutedToolCallBatch> =>
  Effect.gen(function* () {
    const messages: aiTypes.ToolResultMessage[] = [];
    for (const toolCall of toolCalls) {
      yield* emit(toolExecutionStart(toolCall));
      const finalized: typesModule.AgentToolCallOutcome = {
        isError: true,
        result: createErrorToolResult(
          `Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
        ),
        toolCall,
      };
      yield* emitToolExecutionEnd(finalized, emit);
      messages.push(yield* emitToolResultMessage(finalized, emit));
    }
    return { messages, terminate: false };
  });

const finalizeOne = (batch: toolBatchTypes.ToolBatch, toolCall: typesModule.AgentToolCall) =>
  Effect.gen(function* () {
    yield* batch.emit(toolExecutionStart(toolCall));
    const preparation = yield* prepareToolCall({ ...batch, toolCall });
    if (preparation.kind === "immediate") {
      return {
        finalized: { isError: preparation.isError, result: preparation.result, toolCall },
        immediate: true,
      } as const;
    }
    return {
      immediate: false,
      run: executeAndFinalize({
        ...batch,
        onUpdate: toolUpdates(toolCall, batch.emit),
        prepared: preparation,
      }),
    } as const;
  });

const executeSequential = (
  batch: toolBatchTypes.ToolBatch,
): Effect.Effect<toolBatchTypes.ExecutedToolCallBatch> =>
  Effect.gen(function* () {
    const finalizedCalls: typesModule.AgentToolCallOutcome[] = [];
    const messages: aiTypes.ToolResultMessage[] = [];
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
  batch: toolBatchTypes.ToolBatch,
  toolCall: typesModule.AgentToolCall,
  run: Effect.Effect<typesModule.AgentToolCallOutcome>,
): Effect.Effect<typesModule.AgentToolCallOutcome> =>
  Effect.gen(function* () {
    const finalized: typesModule.AgentToolCallOutcome =
      batch.signal?.aborted === true
        ? { isError: true, result: createErrorToolResult("Operation aborted"), toolCall }
        : yield* run;
    yield* emitToolExecutionEnd(finalized, batch.emit);
    return finalized;
  });

const executeParallel = (
  batch: toolBatchTypes.ToolBatch,
): Effect.Effect<toolBatchTypes.ExecutedToolCallBatch> =>
  Effect.gen(function* () {
    const entries: Effect.Effect<typesModule.AgentToolCallOutcome>[] = [];
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
    const messages: aiTypes.ToolResultMessage[] = [];
    for (const finalized of ordered) {
      messages.push(yield* emitToolResultMessage(finalized, batch.emit));
    }
    return { messages, terminate: shouldTerminate(ordered) };
  });

const executeToolCalls = (
  request: toolBatchTypes.ToolBatchRequest,
): Effect.Effect<toolBatchTypes.ExecutedToolCallBatch> => {
  const toolCalls = request.assistantMessage.content.filter(
    (content): content is typesModule.AgentToolCall => content.type === "toolCall",
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

const toolBatch = {
  executeToolCalls,
  failToolCallsFromTruncatedMessage,
};

export default toolBatch;
