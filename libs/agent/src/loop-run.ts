import { Effect } from "effect";

import callModule from "./call.ts";
import type loopRunTypes from "./loop-run.types.ts";
import loop from "./loop.ts";
import type loopTypes from "./loop.types.ts";
import streamFnModule from "./stream-fn.ts";
import type toolBatchTypes from "./tool-batch.types.ts";
import toolChanges from "./tool-changes.ts";
import type typesModule from "./types.ts";

const { call } = callModule;
const { getDefaultStreamFn } = streamFnModule;
const { declareToolChanges } = toolChanges;
const { runLoop } = loop;

const emitTo =
  (sink: loopRunTypes.AgentEventSink): toolBatchTypes.Emit =>
  (event) =>
    call(() => sink(event));

const loopState = (
  run: loopRunTypes.LoopRun,
  context: typesModule.AgentContext,
  newMessages: typesModule.AgentMessage[],
): loopTypes.LoopState => ({
  config: run.config,
  context,
  emit: run.emit,
  explicitContinuation: false,
  hasMoreToolCalls: true,
  lastCompletedTurn: undefined,
  newMessages,
  pendingMessages: [],
  signal: run.signal,
  streamFunction: run.streamFn ?? getDefaultStreamFn(),
});

const runPrompt = (run: loopRunTypes.PromptRun): Effect.Effect<typesModule.AgentMessage[]> =>
  Effect.gen(function* () {
    const initialMessages = declareToolChanges({ context: run.context, messages: run.prompts });
    yield* run.emit({ type: "agent_start" });
    yield* run.emit({ type: "turn_start" });
    const newMessages: typesModule.AgentMessage[] = [];
    for (const message of initialMessages) {
      yield* run.emit({ message, type: "message_start" });
      const end = { message, type: "message_end" as const };
      yield* run.emit(end);
      newMessages.push(end.message);
    }
    const context: typesModule.AgentContext = {
      ...run.context,
      messages: [...run.context.messages, ...newMessages],
    };
    yield* runLoop(loopState(run, context, newMessages));
    return newMessages;
  });

const continuationError = (context: typesModule.AgentContext): Error | undefined => {
  const lastMessage = context.messages.at(-1);
  if (lastMessage === undefined) return new Error("Cannot continue: no messages in context");
  if (lastMessage.role === "assistant") {
    return new Error("Cannot continue from message role: assistant");
  }
  return undefined;
};

const runContinuation = (run: loopRunTypes.LoopRun): Effect.Effect<typesModule.AgentMessage[]> =>
  Effect.gen(function* () {
    const error = continuationError(run.context);
    if (error !== undefined) return yield* Effect.die(error);
    const newMessages: typesModule.AgentMessage[] = [];
    yield* run.emit({ type: "agent_start" });
    yield* run.emit({ type: "turn_start" });
    yield* runLoop(loopState(run, { ...run.context }, newMessages));
    return newMessages;
  });

const loopRun = {
  continuationError,
  emitTo,
  runContinuation,
  runPrompt,
};

export default loopRun;
