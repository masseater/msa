import { EventStream } from "@msa/ai";
import type { AssistantMessage } from "@msa/ai";
import { Effect, Function } from "effect";

import {
  type AgentEventSink,
  continuationError,
  emitTo,
  runContinuation,
  runPrompt,
} from "./loop-run.ts";
import {
  prepareToolCall,
  executeAndFinalize,
  type ToolCallHooks,
  type ToolUpdateSink,
} from "./tool-call.ts";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolCallOutcome,
  StreamFn,
} from "./types.ts";

export type { AgentEventSink } from "./loop-run.ts";
export type { ToolCallHooks } from "./tool-call.ts";

const createAgentStream = (): EventStream<AgentEvent, AgentMessage[]> =>
  new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === "agent_end",
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
  );

const streamRun = (
  run: (emit: AgentEventSink) => Effect.Effect<AgentMessage[]>,
): EventStream<AgentEvent, AgentMessage[]> => {
  const stream = createAgentStream();
  Effect.runFork(
    Effect.flatMap(
      run((event) => {
        stream.push(event);
      }),
      (messages) =>
        Effect.sync(() => {
          stream.end(messages);
        }),
    ),
  );
  return stream;
};

const isContext = (value: unknown): value is AgentContext =>
  typeof value === "object" && value !== null && "messages" in value;

export const agentLoop: {
  (
    context: AgentContext,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): (prompts: AgentMessage[]) => EventStream<AgentEvent, AgentMessage[]>;
  (
    prompts: AgentMessage[],
    context: AgentContext,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): EventStream<AgentEvent, AgentMessage[]>;
} = Function.dual(
  (args) => Array.isArray(args[0]),
  (
    prompts: AgentMessage[],
    context: AgentContext,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: StreamFn | undefined,
  ): EventStream<AgentEvent, AgentMessage[]> =>
    streamRun((sink) =>
      runPrompt({ prompts, context, config, emit: emitTo(sink), signal, streamFn }),
    ),
);

export const agentLoopContinue: {
  (
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): (context: AgentContext) => EventStream<AgentEvent, AgentMessage[]>;
  (
    context: AgentContext,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): EventStream<AgentEvent, AgentMessage[]>;
} = Function.dual(
  (args) => isContext(args[0]),
  (
    context: AgentContext,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: StreamFn | undefined,
  ): EventStream<AgentEvent, AgentMessage[]> => {
    const error = continuationError(context);
    if (error !== undefined) throw error;
    return streamRun((sink) =>
      runContinuation({ context, config, emit: emitTo(sink), signal, streamFn }),
    );
  },
);

export const runAgentLoop: {
  (
    context: AgentContext,
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): (prompts: AgentMessage[]) => Promise<AgentMessage[]>;
  (
    prompts: AgentMessage[],
    context: AgentContext,
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): Promise<AgentMessage[]>;
} = Function.dual(
  (args) => Array.isArray(args[0]),
  (
    prompts: AgentMessage[],
    context: AgentContext,
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: StreamFn | undefined,
  ): Promise<AgentMessage[]> =>
    Effect.runPromise(
      runPrompt({ prompts, context, config, emit: emitTo(emit), signal, streamFn }),
    ),
);

export const runAgentLoopContinue: {
  (
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): (context: AgentContext) => Promise<AgentMessage[]>;
  (
    context: AgentContext,
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: StreamFn,
  ): Promise<AgentMessage[]>;
} = Function.dual(
  (args) => isContext(args[0]),
  (
    context: AgentContext,
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: StreamFn | undefined,
  ): Promise<AgentMessage[]> =>
    Effect.runPromise(runContinuation({ context, config, emit: emitTo(emit), signal, streamFn })),
);

export interface RunToolCallOptions extends ToolCallHooks {
  tools: readonly AgentTool<any>[];
  assistantMessage: AssistantMessage;
  context: AgentContext;
  signal?: AbortSignal;
  onUpdate?: ToolUpdateSink;
}

const runToolCallEffect = (
  toolCall: AgentToolCall,
  options: RunToolCallOptions,
): Effect.Effect<AgentToolCallOutcome> =>
  Effect.gen(function* () {
    const site = {
      context: options.context,
      assistantMessage: options.assistantMessage,
      hooks: options,
      signal: options.signal,
    };
    const preparation = yield* prepareToolCall({ ...site, toolCall, tools: options.tools });
    if (preparation.kind === "immediate") {
      return { toolCall, result: preparation.result, isError: preparation.isError };
    }
    return yield* executeAndFinalize({
      ...site,
      prepared: preparation,
      onUpdate: options.onUpdate ?? (() => undefined),
    });
  });

export const runToolCall: {
  (options: RunToolCallOptions): (toolCall: AgentToolCall) => Promise<AgentToolCallOutcome>;
  (toolCall: AgentToolCall, options: RunToolCallOptions): Promise<AgentToolCallOutcome>;
} = Function.dual(
  2,
  (toolCall: AgentToolCall, options: RunToolCallOptions): Promise<AgentToolCallOutcome> =>
    Effect.runPromise(runToolCallEffect(toolCall, options)),
);
