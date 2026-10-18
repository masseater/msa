import { Effect } from "effect";

import { call } from "./call.ts";
import { type LoopState, runLoop } from "./loop.ts";
import { getDefaultStreamFn } from "./stream-fn.ts";
import type { Emit } from "./tool-batch.ts";
import { declareToolChanges } from "./tool-changes.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "./types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

export const emitTo =
  (sink: AgentEventSink): Emit =>
  (event) =>
    call(() => sink(event));

export interface LoopRun {
  readonly context: AgentContext;
  readonly config: AgentLoopConfig;
  readonly emit: Emit;
  readonly signal: AbortSignal | undefined;
  readonly streamFn: StreamFn | undefined;
}

export interface PromptRun extends LoopRun {
  readonly prompts: AgentMessage[];
}

const loopState = (
  run: LoopRun,
  context: AgentContext,
  newMessages: AgentMessage[],
): LoopState => ({
  context,
  config: run.config,
  lastCompletedTurn: undefined,
  explicitContinuation: false,
  pendingMessages: [],
  hasMoreToolCalls: true,
  newMessages,
  signal: run.signal,
  emit: run.emit,
  streamFunction: run.streamFn ?? getDefaultStreamFn(),
});

export const runPrompt = (run: PromptRun): Effect.Effect<AgentMessage[]> =>
  Effect.gen(function* () {
    const initialMessages = declareToolChanges({ context: run.context, messages: run.prompts });
    const newMessages: AgentMessage[] = [...initialMessages];
    const context: AgentContext = {
      ...run.context,
      messages: [...run.context.messages, ...initialMessages],
    };
    yield* run.emit({ type: "agent_start" });
    yield* run.emit({ type: "turn_start" });
    for (const message of initialMessages) {
      yield* run.emit({ type: "message_start", message });
      yield* run.emit({ type: "message_end", message });
    }
    yield* runLoop(loopState(run, context, newMessages));
    return newMessages;
  });

export const continuationError = (context: AgentContext): Error | undefined => {
  const lastMessage = context.messages.at(-1);
  if (lastMessage === undefined) return new Error("Cannot continue: no messages in context");
  if (lastMessage.role === "assistant") {
    return new Error("Cannot continue from message role: assistant");
  }
  return undefined;
};

export const runContinuation = (run: LoopRun): Effect.Effect<AgentMessage[]> =>
  Effect.gen(function* () {
    const error = continuationError(run.context);
    if (error !== undefined) return yield* Effect.die(error);
    const newMessages: AgentMessage[] = [];
    yield* run.emit({ type: "agent_start" });
    yield* run.emit({ type: "turn_start" });
    yield* runLoop(loopState(run, { ...run.context }, newMessages));
    return newMessages;
  });
