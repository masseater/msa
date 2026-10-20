import ai from "@msa/ai";
import { Cause, Effect, Exit } from "effect";

import callModule from "./call.ts";
import type toolCallTypes from "./tool-call.types.ts";
import type typesModule from "./types.ts";

const { validateToolArguments } = ai;

const { call } = callModule;

const createErrorToolResult = (message: string): typesModule.AgentToolResult<any> => ({
  content: [{ text: message, type: "text" }],
  details: {},
});

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const immediateError = (message: string): toolCallTypes.ImmediateToolCallOutcome => ({
  isError: true,
  kind: "immediate",
  result: createErrorToolResult(message),
});

const prepareToolCallArguments = (
  tool: typesModule.AgentTool<any>,
  toolCall: typesModule.AgentToolCall,
): typesModule.AgentToolCall => {
  if (tool.prepareArguments === undefined) return toolCall;
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) return toolCall;
  return { ...toolCall, arguments: preparedArguments as Record<string, any> };
};

const aborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const runBeforeHook = (
  request: toolCallTypes.ToolCallRequest,
  args: unknown,
): Effect.Effect<toolCallTypes.ImmediateToolCallOutcome | undefined> =>
  Effect.gen(function* () {
    const before = request.hooks.beforeToolCall;
    if (before === undefined) return undefined;
    const { assistantMessage, toolCall, context, signal } = request;
    const beforeResult = yield* call(() =>
      before({ args, assistantMessage, context, toolCall }, signal),
    );
    if (aborted(signal)) return immediateError("Operation aborted");
    if (beforeResult?.block !== true) return undefined;
    const reason = beforeResult.reason;
    const result = createErrorToolResult(
      reason === undefined || reason === "" ? "Tool execution was blocked" : reason,
    );
    if (beforeResult.terminate === true) result.terminate = true;
    return { isError: true, kind: "immediate", result };
  });

const prepareToolCall = (
  request: toolCallTypes.ToolCallRequest,
): Effect.Effect<toolCallTypes.PreparedToolCall | toolCallTypes.ImmediateToolCallOutcome> =>
  Effect.gen(function* () {
    const { toolCall } = request;
    const tools = request.tools ?? request.context.tools ?? [];
    const tool = tools.find((candidate) => candidate.name === toolCall.name);
    if (tool === undefined) return immediateError(`Tool ${toolCall.name} not found`);
    const args = validateToolArguments(tool, prepareToolCallArguments(tool, toolCall));
    const blocked = yield* runBeforeHook(request, args);
    if (blocked !== undefined) return blocked;
    if (aborted(request.signal)) return immediateError("Operation aborted");
    return { args, kind: "prepared", tool, toolCall } satisfies toolCallTypes.PreparedToolCall;
  }).pipe(
    Effect.catchCause((cause) => Effect.succeed(immediateError(errorText(Cause.squash(cause))))),
  );

const executePreparedToolCall = ({
  prepared,
  signal,
  onUpdate,
}: toolCallTypes.ToolExecution): Effect.Effect<toolCallTypes.ExecutedToolCallOutcome> =>
  Effect.gen(function* () {
    const updateEvents: Promise<void>[] = [];
    let acceptingUpdates = true;
    const startedAt = performance.now();
    const exit = yield* Effect.exit(
      call(() =>
        prepared.tool.execute(prepared.toolCall.id, prepared.args as never, signal, (partial) => {
          if (!acceptingUpdates) return;
          updateEvents.push(Promise.resolve(onUpdate(partial)));
        }),
      ),
    );
    const durationMs = Math.round(performance.now() - startedAt);
    acceptingUpdates = false;
    yield* Effect.promise(() => Promise.all(updateEvents));
    if (Exit.isSuccess(exit)) {
      return { durationMs, isError: exit.value.isError === true, result: exit.value };
    }
    return {
      durationMs,
      isError: true,
      result: createErrorToolResult(errorText(Cause.squash(exit.cause))),
    };
  });

const mergeAfterResult = (
  { result, isError }: toolCallTypes.ExecutedToolCallOutcome,
  afterResult: typesModule.AfterToolCallResult,
): Pick<typesModule.AgentToolCallOutcome, "result" | "isError"> => {
  const structuredContent =
    afterResult.structuredContent ??
    (afterResult.content === undefined ? result.structuredContent : undefined);
  const { structuredContent: _replaced, ...rest } = result;
  return {
    isError: afterResult.isError ?? isError,
    result: {
      ...rest,
      content: afterResult.content ?? result.content,
      details: afterResult.details ?? result.details,
      terminate: afterResult.terminate ?? result.terminate,
      usage: afterResult.usage ?? result.usage,
      ...(structuredContent === undefined ? {} : { structuredContent }),
    },
  };
};

const runAfterHook = (
  finalization: toolCallTypes.ToolFinalization,
): Effect.Effect<Pick<typesModule.AgentToolCallOutcome, "result" | "isError">> => {
  const { executed, hooks, prepared } = finalization;
  const after = hooks.afterToolCall;
  if (after === undefined) return Effect.succeed(executed);
  return call(() =>
    after(
      {
        args: prepared.args,
        assistantMessage: finalization.assistantMessage,
        context: finalization.context,
        isError: executed.isError,
        result: executed.result,
        toolCall: prepared.toolCall,
      },
      finalization.signal,
    ),
  ).pipe(
    Effect.map((afterResult) =>
      afterResult === undefined ? executed : mergeAfterResult(executed, afterResult),
    ),
    Effect.catchCause((cause) =>
      Effect.succeed({
        isError: true,
        result: createErrorToolResult(errorText(Cause.squash(cause))),
      }),
    ),
  );
};

const finalizeExecutedToolCall = (
  finalization: toolCallTypes.ToolFinalization,
): Effect.Effect<typesModule.AgentToolCallOutcome> =>
  Effect.map(runAfterHook(finalization), ({ result, isError }) => ({
    durationMs: finalization.executed.durationMs,
    isError,
    result,
    toolCall: finalization.prepared.toolCall,
  }));

const executeAndFinalize = (
  run: toolCallTypes.ToolRun,
): Effect.Effect<typesModule.AgentToolCallOutcome> =>
  Effect.flatMap(executePreparedToolCall(run), (executed) =>
    finalizeExecutedToolCall({ ...run, executed }),
  );

const toolCallModule = {
  createErrorToolResult,
  executeAndFinalize,
  executePreparedToolCall,
  finalizeExecutedToolCall,
  prepareToolCall,
};

export default toolCallModule;
