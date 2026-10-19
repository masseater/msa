import type { AssistantMessage, ToolResultMessage } from "@msa/ai";
import { Effect } from "effect";

import { streamAssistantResponse } from "./assistant-response.ts";
import { call } from "./call.ts";
import { type Emit, executeToolCalls, failToolCallsFromTruncatedMessage } from "./tool-batch.ts";
import { declareToolChanges, withRequestState } from "./tool-changes.ts";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentToolCall,
  PrepareNextTurnContext,
  StreamFn,
} from "./types.ts";

export interface LoopState {
  context: AgentContext;
  config: AgentLoopConfig;
  lastCompletedTurn: PrepareNextTurnContext | undefined;
  explicitContinuation: boolean;
  pendingMessages: AgentMessage[];
  hasMoreToolCalls: boolean;
  readonly newMessages: AgentMessage[];
  readonly signal: AbortSignal | undefined;
  readonly emit: Emit;
  readonly streamFunction: StreamFn;
}

const pollSteering = (config: AgentLoopConfig): Effect.Effect<AgentMessage[]> =>
  Effect.map(
    call(() => config.getSteeringMessages?.()),
    (messages) => messages ?? [],
  );

const pollFollowUps = (config: AgentLoopConfig): Effect.Effect<AgentMessage[]> =>
  Effect.map(
    call(() => config.getFollowUpMessages?.()),
    (messages) => messages ?? [],
  );

const startTurn = (state: LoopState): Effect.Effect<AgentMessage[]> =>
  Effect.gen(function* () {
    const turn = state.lastCompletedTurn;
    if (turn === undefined) return [];
    const snapshot = yield* call(() => state.config.prepareNextTurn?.(turn));
    let prepared: AgentMessage[] = [];
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

const appendMessages = (state: LoopState, prepared: AgentMessage[]): Effect.Effect<void> =>
  Effect.gen(function* () {
    const messages = declareToolChanges({
      context: state.context,
      messages: [...prepared, ...state.pendingMessages],
    });
    for (const message of messages) {
      yield* state.emit({ type: "message_start", message });
      yield* state.emit({ type: "message_end", message });
      state.context.messages.push(message);
      state.newMessages.push(message);
    }
    state.pendingMessages = [];
  });

const applyRequestUpdate = (state: LoopState): Effect.Effect<void> =>
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
  state: LoopState,
  message: AssistantMessage,
): Effect.Effect<ToolResultMessage[]> =>
  Effect.gen(function* () {
    state.hasMoreToolCalls = false;
    const toolCalls = message.content.filter(
      (content): content is AgentToolCall => content.type === "toolCall",
    );
    if (toolCalls.length === 0) return [];
    const batch =
      message.stopReason === "length"
        ? yield* failToolCallsFromTruncatedMessage({ toolCalls, emit: state.emit })
        : yield* executeToolCalls({
            context: state.context,
            assistantMessage: message,
            hooks: state.config,
            signal: state.signal,
            emit: state.emit,
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
  state: LoopState,
  message: AssistantMessage,
  toolResults: ToolResultMessage[],
) =>
  Effect.gen(function* () {
    const turn = { message, toolResults, context: state.context, newMessages: state.newMessages };
    state.lastCompletedTurn = turn;
    const decision = yield* call(() => state.config.finishTurn?.(turn, state.signal));
    yield* state.emit({ type: "turn_end", message, toolResults });
    return decision ?? undefined;
  });

const endRun = (state: LoopState): Effect.Effect<"end"> =>
  Effect.as(state.emit({ type: "agent_end", messages: state.newMessages }), "end" as const);

const runTurn = (state: LoopState): Effect.Effect<"end" | "continue"> =>
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

const runTurns = (state: LoopState): Effect.Effect<"end" | "idle"> =>
  Effect.gen(function* () {
    state.hasMoreToolCalls = true;
    while (state.hasMoreToolCalls || state.pendingMessages.length > 0) {
      if ((yield* runTurn(state)) === "end") return "end";
    }
    return "idle";
  });

export const runLoop = (state: LoopState): Effect.Effect<void> =>
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
