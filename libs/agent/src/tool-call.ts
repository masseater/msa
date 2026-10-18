import { type AssistantMessage, validateToolArguments } from "@msa/ai";
import { Cause, Effect, Exit } from "effect";

import { call } from "./call.ts";
import type {
  AfterToolCallResult,
  AgentContext,
  AgentLoopConfig,
  AgentTool,
  AgentToolCall,
  AgentToolCallOutcome,
  AgentToolResult,
} from "./types.ts";

export type ToolCallHooks = Pick<AgentLoopConfig, "beforeToolCall" | "afterToolCall">;

export type ToolUpdateSink = (partialResult: AgentToolResult<any>) => Promise<void> | void;

export type PreparedToolCall = {
  kind: "prepared";
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
};

export type ImmediateToolCallOutcome = {
  kind: "immediate";
  result: AgentToolResult<any>;
  isError: boolean;
};

type ExecutedToolCallOutcome = {
  result: AgentToolResult<any>;
  isError: boolean;
  durationMs: number;
};

export const createErrorToolResult = (message: string): AgentToolResult<any> => ({
  content: [{ type: "text", text: message }],
  details: {},
});

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const immediateError = (message: string): ImmediateToolCallOutcome => ({
  kind: "immediate",
  result: createErrorToolResult(message),
  isError: true,
});

export interface ToolCallSite {
  readonly context: AgentContext;
  readonly assistantMessage: AssistantMessage;
  readonly hooks: ToolCallHooks;
  readonly signal: AbortSignal | undefined;
}

export interface ToolCallRequest extends ToolCallSite {
  readonly toolCall: AgentToolCall;
  readonly tools?: readonly AgentTool<any>[] | undefined;
}

const prepareToolCallArguments = (tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall => {
  if (tool.prepareArguments === undefined) return toolCall;
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) return toolCall;
  return { ...toolCall, arguments: preparedArguments as Record<string, any> };
};

const aborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const runBeforeHook = (
  request: ToolCallRequest,
  args: unknown,
): Effect.Effect<ImmediateToolCallOutcome | undefined> =>
  Effect.gen(function* () {
    const before = request.hooks.beforeToolCall;
    if (before === undefined) return undefined;
    const { assistantMessage, toolCall, context, signal } = request;
    const beforeResult = yield* call(() =>
      before({ assistantMessage, toolCall, args, context }, signal),
    );
    if (aborted(signal)) return immediateError("Operation aborted");
    if (beforeResult?.block !== true) return undefined;
    const reason = beforeResult.reason;
    const result = createErrorToolResult(
      reason === undefined || reason === "" ? "Tool execution was blocked" : reason,
    );
    if (beforeResult.terminate === true) result.terminate = true;
    return { kind: "immediate", result, isError: true };
  });

export const prepareToolCall = (
  request: ToolCallRequest,
): Effect.Effect<PreparedToolCall | ImmediateToolCallOutcome> =>
  Effect.gen(function* () {
    const { toolCall } = request;
    const tools = request.tools ?? request.context.tools ?? [];
    const tool = tools.find((candidate) => candidate.name === toolCall.name);
    if (tool === undefined) return immediateError(`Tool ${toolCall.name} not found`);
    const args = validateToolArguments(tool, prepareToolCallArguments(tool, toolCall));
    const blocked = yield* runBeforeHook(request, args);
    if (blocked !== undefined) return blocked;
    if (aborted(request.signal)) return immediateError("Operation aborted");
    return { kind: "prepared", toolCall, tool, args } satisfies PreparedToolCall;
  }).pipe(
    Effect.catchCause((cause) => Effect.succeed(immediateError(errorText(Cause.squash(cause))))),
  );

export interface ToolExecution {
  readonly prepared: PreparedToolCall;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: ToolUpdateSink;
}

export const executePreparedToolCall = ({
  prepared,
  signal,
  onUpdate,
}: ToolExecution): Effect.Effect<ExecutedToolCallOutcome> =>
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
      return { result: exit.value, isError: exit.value.isError === true, durationMs };
    }
    return {
      result: createErrorToolResult(errorText(Cause.squash(exit.cause))),
      isError: true,
      durationMs,
    };
  });

const mergeAfterResult = (
  { result, isError }: ExecutedToolCallOutcome,
  afterResult: AfterToolCallResult,
): Pick<AgentToolCallOutcome, "result" | "isError"> => {
  const structuredContent =
    afterResult.structuredContent ??
    (afterResult.content === undefined ? result.structuredContent : undefined);
  const { structuredContent: _replaced, ...rest } = result;
  return {
    result: {
      ...rest,
      content: afterResult.content ?? result.content,
      details: afterResult.details ?? result.details,
      usage: afterResult.usage ?? result.usage,
      terminate: afterResult.terminate ?? result.terminate,
      ...(structuredContent === undefined ? {} : { structuredContent }),
    },
    isError: afterResult.isError ?? isError,
  };
};

export interface ToolFinalization extends ToolCallSite {
  readonly prepared: PreparedToolCall;
  readonly executed: ExecutedToolCallOutcome;
}

const runAfterHook = (
  finalization: ToolFinalization,
): Effect.Effect<Pick<AgentToolCallOutcome, "result" | "isError">> => {
  const { executed, hooks, prepared } = finalization;
  const after = hooks.afterToolCall;
  if (after === undefined) return Effect.succeed(executed);
  return call(() =>
    after(
      {
        assistantMessage: finalization.assistantMessage,
        toolCall: prepared.toolCall,
        args: prepared.args,
        result: executed.result,
        isError: executed.isError,
        context: finalization.context,
      },
      finalization.signal,
    ),
  ).pipe(
    Effect.map((afterResult) =>
      afterResult === undefined ? executed : mergeAfterResult(executed, afterResult),
    ),
    Effect.catchCause((cause) =>
      Effect.succeed({
        result: createErrorToolResult(errorText(Cause.squash(cause))),
        isError: true,
      }),
    ),
  );
};

export const finalizeExecutedToolCall = (
  finalization: ToolFinalization,
): Effect.Effect<AgentToolCallOutcome> =>
  Effect.map(runAfterHook(finalization), ({ result, isError }) => ({
    toolCall: finalization.prepared.toolCall,
    result,
    isError,
    durationMs: finalization.executed.durationMs,
  }));

export interface ToolRun extends ToolCallSite {
  readonly prepared: PreparedToolCall;
  readonly onUpdate: ToolUpdateSink;
}

export const executeAndFinalize = (run: ToolRun): Effect.Effect<AgentToolCallOutcome> =>
  Effect.flatMap(executePreparedToolCall(run), (executed) =>
    finalizeExecutedToolCall({ ...run, executed }),
  );
