import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import assistantResponse from "./assistant-response.ts";
import callModule from "./call.ts";
import type loopTypes from "./loop.types.ts";
import toolBatch from "./tool-batch.ts";
import toolChanges from "./tool-changes.ts";
import type typesModule from "./types.ts";

const { call } = callModule;
const { declareToolChanges, withRequestState } = toolChanges;
const { executeToolCalls, failToolCallsFromTruncatedMessage } = toolBatch;
const { streamAssistantResponse } = assistantResponse;

const pollSteering = (
  config: typesModule.AgentLoopConfig,
): Effect.Effect<typesModule.AgentMessage[]> =>
  Effect.map(
    call(() => config.getSteeringMessages?.()),
    (messages) => messages ?? [],
  );

const pollFollowUps = (
  config: typesModule.AgentLoopConfig,
): Effect.Effect<typesModule.AgentMessage[]> =>
  Effect.map(
    call(() => config.getFollowUpMessages?.()),
    (messages) => messages ?? [],
  );

const startTurn = (state: loopTypes.LoopState): Effect.Effect<typesModule.AgentMessage[]> =>
  Effect.gen(function* () {
    const turn = state.lastCompletedTurn;
    if (turn === undefined) return [];
    const snapshot = yield* call(() => state.config.prepareNextTurn?.(turn));
    let prepared: typesModule.AgentMessage[] = [];
    if (snapshot !== undefined) {
      state.context = snapshot.context ?? state.context;
      prepared = snapshot.messages ?? [];
      state.config = withRequestState({
        config: state.config,
        model: snapshot.model ?? state.config.model,
        thinkingLevel: snapshot.thinkingLevel,
      });
    }
    if (state.pendingMessages.length === 0)
      state.pendingMessages = yield* pollSteering(state.config);
    yield* state.emit({ type: "turn_start" });
    return prepared;
  });

const appendMessages = (
  state: loopTypes.LoopState,
  prepared: typesModule.AgentMessage[],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const messages = declareToolChanges({
      context: state.context,
      messages: [...prepared, ...state.pendingMessages],
    });
    for (const message of messages) {
      yield* state.emit({ message, type: "message_start" });
      yield* state.emit({ message, type: "message_end" });
      state.context.messages.push(message);
      state.newMessages.push(message);
    }
    state.pendingMessages = [];
  });

const applyRequestUpdate = (state: loopTypes.LoopState): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { config, context, signal } = state;
    const update = yield* call(() =>
      config.prepareRequest?.(
        { context, model: config.model, thinkingLevel: config.reasoning ?? "off" },
        signal,
      ),
    );
    if (update === undefined || update === null) return;
    state.context = update.context ?? state.context;
    state.config = withRequestState({
      config: state.config,
      model: update.model ?? state.config.model,
      thinkingLevel: update.thinkingLevel,
    });
  });

const runToolCalls = (
  state: loopTypes.LoopState,
  message: aiTypes.AssistantMessage,
): Effect.Effect<aiTypes.ToolResultMessage[]> =>
  Effect.gen(function* () {
    state.hasMoreToolCalls = false;
    const toolCalls = message.content.filter(
      (content): content is typesModule.AgentToolCall => content.type === "toolCall",
    );
    if (toolCalls.length === 0) return [];
    const batch =
      message.stopReason === "length"
        ? yield* failToolCallsFromTruncatedMessage({ emit: state.emit, toolCalls })
        : yield* executeToolCalls({
            assistantMessage: message,
            context: state.context,
            emit: state.emit,
            hooks: state.config,
            signal: state.signal,
            toolExecution: state.config.toolExecution,
          });
    state.hasMoreToolCalls = !batch.terminate;
    for (const result of batch.messages) {
      state.context.messages.push(result);
      state.newMessages.push(result);
    }
    return [...batch.messages];
  });

const finishTurn = (
  state: loopTypes.LoopState,
  message: aiTypes.AssistantMessage,
  toolResults: aiTypes.ToolResultMessage[],
) =>
  Effect.gen(function* () {
    const turn = { context: state.context, message, newMessages: state.newMessages, toolResults };
    state.lastCompletedTurn = turn;
    const decision = yield* call(() => state.config.finishTurn?.(turn, state.signal));
    yield* state.emit({ message, toolResults, type: "turn_end" });
    return decision ?? undefined;
  });

const endRun = (state: loopTypes.LoopState): Effect.Effect<"end"> =>
  Effect.as(state.emit({ messages: state.newMessages, type: "agent_end" }), "end" as const);

const runTurn = (state: loopTypes.LoopState): Effect.Effect<"end" | "continue"> =>
  Effect.gen(function* () {
    yield* appendMessages(state, yield* startTurn(state));
    yield* applyRequestUpdate(state);
    const message = yield* streamAssistantResponse(state);
    state.newMessages.push(message);
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      yield* finishTurn(state, message, []);
      return yield* endRun(state);
    }
    const decision = yield* finishTurn(state, message, yield* runToolCalls(state, message));
    if (decision?.action === "end") return yield* endRun(state);
    state.explicitContinuation = decision?.action === "continue";
    state.pendingMessages = yield* pollSteering(state.config);
    if (state.hasMoreToolCalls || state.pendingMessages.length > 0) {
      state.explicitContinuation = false;
    }
    return "continue";
  });

const runTurns = (state: loopTypes.LoopState): Effect.Effect<"end" | "idle"> =>
  Effect.gen(function* () {
    state.hasMoreToolCalls = true;
    while (state.hasMoreToolCalls || state.pendingMessages.length > 0) {
      if ((yield* runTurn(state)) === "end") return "end";
    }
    return "idle";
  });

const runLoop = (state: loopTypes.LoopState): Effect.Effect<void> =>
  Effect.gen(function* () {
    state.pendingMessages = yield* pollSteering(state.config);
    for (;;) {
      if ((yield* runTurns(state)) === "end") return;
      const followUps = yield* pollFollowUps(state.config);
      if (followUps.length > 0) {
        state.explicitContinuation = false;
        state.pendingMessages = followUps;
      } else if (state.explicitContinuation) {
        state.explicitContinuation = false;
      } else {
        break;
      }
    }
    yield* endRun(state);
  });

const loop = {
  runLoop,
};

export default loop;
