import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect, Function } from "effect";

import type agentLoopTypes from "./agent-loop.types.ts";
import loopRun from "./loop-run.ts";
import type loopRunTypes from "./loop-run.types.ts";
import toolCallModule from "./tool-call.ts";
import type typesModule from "./types.ts";

const { EventStream } = ai;

const { continuationError, emitTo, runContinuation, runPrompt } = loopRun;
const { executeAndFinalize, prepareToolCall } = toolCallModule;

const createAgentStream = (): aiTypes.EventStream<
  typesModule.AgentEvent,
  typesModule.AgentMessage[]
> =>
  new EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]>(
    (event: typesModule.AgentEvent) => event.type === "agent_end",
    (event: typesModule.AgentEvent) => (event.type === "agent_end" ? event.messages : []),
  );

const streamRun = (
  run: (emit: loopRunTypes.AgentEventSink) => Effect.Effect<typesModule.AgentMessage[]>,
): aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]> => {
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

const isContext = (value: unknown): value is typesModule.AgentContext =>
  typeof value === "object" && value !== null && "messages" in value;

const agentLoop: {
  (
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): (
    prompts: typesModule.AgentMessage[],
  ) => aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]>;
  (
    prompts: typesModule.AgentMessage[],
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]>;
} = Function.dual(
  (args) => Array.isArray(args[0]),
  (
    prompts: typesModule.AgentMessage[],
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn | undefined,
  ): aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]> =>
    streamRun((sink) =>
      runPrompt({ config, context, emit: emitTo(sink), prompts, signal, streamFn }),
    ),
);

const agentLoopContinue: {
  (
    config: typesModule.AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): (
    context: typesModule.AgentContext,
  ) => aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]>;
  (
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]>;
} = Function.dual(
  (args) => isContext(args[0]),
  (
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn | undefined,
  ): aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]> => {
    const error = continuationError(context);
    if (error !== undefined) throw error;
    return streamRun((sink) =>
      runContinuation({ config, context, emit: emitTo(sink), signal, streamFn }),
    );
  },
);

const runAgentLoop: {
  (
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    emit: loopRunTypes.AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): (prompts: typesModule.AgentMessage[]) => Promise<typesModule.AgentMessage[]>;
  (
    prompts: typesModule.AgentMessage[],
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    emit: loopRunTypes.AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): Promise<typesModule.AgentMessage[]>;
} = Function.dual(
  (args) => Array.isArray(args[0]),
  (
    prompts: typesModule.AgentMessage[],
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    emit: loopRunTypes.AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn | undefined,
  ): Promise<typesModule.AgentMessage[]> =>
    Effect.runPromise(
      runPrompt({ config, context, emit: emitTo(emit), prompts, signal, streamFn }),
    ),
);

const runAgentLoopContinue: {
  (
    config: typesModule.AgentLoopConfig,
    emit: loopRunTypes.AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): (context: typesModule.AgentContext) => Promise<typesModule.AgentMessage[]>;
  (
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    emit: loopRunTypes.AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn,
  ): Promise<typesModule.AgentMessage[]>;
} = Function.dual(
  (args) => isContext(args[0]),
  (
    context: typesModule.AgentContext,
    config: typesModule.AgentLoopConfig,
    emit: loopRunTypes.AgentEventSink,
    signal: AbortSignal | undefined,
    streamFn: typesModule.StreamFn | undefined,
  ): Promise<typesModule.AgentMessage[]> =>
    Effect.runPromise(runContinuation({ config, context, emit: emitTo(emit), signal, streamFn })),
);

const runToolCallEffect = (
  toolCall: typesModule.AgentToolCall,
  options: agentLoopTypes.RunToolCallOptions,
): Effect.Effect<typesModule.AgentToolCallOutcome> =>
  Effect.gen(function* () {
    const site = {
      assistantMessage: options.assistantMessage,
      context: options.context,
      hooks: options,
      signal: options.signal,
    };
    const preparation = yield* prepareToolCall({ ...site, toolCall, tools: options.tools });
    if (preparation.kind === "immediate") {
      return { isError: preparation.isError, result: preparation.result, toolCall };
    }
    return yield* executeAndFinalize({
      ...site,
      onUpdate: options.onUpdate ?? (() => undefined),
      prepared: preparation,
    });
  });

const runToolCall: {
  (
    options: agentLoopTypes.RunToolCallOptions,
  ): (toolCall: typesModule.AgentToolCall) => Promise<typesModule.AgentToolCallOutcome>;
  (
    toolCall: typesModule.AgentToolCall,
    options: agentLoopTypes.RunToolCallOptions,
  ): Promise<typesModule.AgentToolCallOutcome>;
} = Function.dual(
  2,
  (
    toolCall: typesModule.AgentToolCall,
    options: agentLoopTypes.RunToolCallOptions,
  ): Promise<typesModule.AgentToolCallOutcome> =>
    Effect.runPromise(runToolCallEffect(toolCall, options)),
);

const agentLoopModule = {
  agentLoop,
  agentLoopContinue,
  runAgentLoop,
  runAgentLoopContinue,
  runToolCall,
};

export default agentLoopModule;
