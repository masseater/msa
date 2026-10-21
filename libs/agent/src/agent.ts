import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import agentKit from "./agent-kit.ts";
import type agentOptionsTypes from "./agent-options.ts";
import type agentStateTypes from "./agent-state.types.ts";
import PendingMessageQueue from "./pending-queue.ts";
import type pendingQueueTypes from "./pending-queue.types.ts";
import streamFnModule from "./stream-fn.ts";
import type typesModule from "./types.ts";

const { agentConfig, agentRun, agentState, loopRun } = agentKit;

const { getCurrentSystemMessage } = ai;

const { AgentRuns, busy, notifyListeners } = agentRun;
const {
  createMutableAgentState,
  defaultConvertToLlm,
  promptMessages,
  reduceAgentEvent,
  runFailureMessage,
} = agentState;
const { getDefaultStreamFn } = streamFnModule;

const { runContinuation, runPrompt } = loopRun;
const { createLoopConfig } = agentConfig;

export default class Agent {
  readonly #state: agentStateTypes.MutableAgentState;
  readonly #listeners = new Set<agentOptionsTypes.AgentListener>();
  readonly #steeringQueue: pendingQueueTypes.PendingMessageQueue;
  readonly #followUpQueue: pendingQueueTypes.PendingMessageQueue;
  #queueSequence = 0;
  readonly #runs = new AgentRuns({
    onFailure: (error, aborted) => this.#handleRunFailure(error, aborted),
    onFinish: () => {
      this.#state.isStreaming = false;
      this.#state.streamingMessage = undefined;
      this.#state.pendingToolCalls = new Set<string>();
    },
    onStart: () => {
      this.#state.isStreaming = true;
      this.#state.streamingMessage = undefined;
      this.#state.errorMessage = undefined;
    },
  });

  public convertToLlm: agentOptionsTypes.ConvertToLlm;
  public transformContext?: agentOptionsTypes.TransformContext | undefined;
  public streamFunction: typesModule.StreamFn;
  public getApiKey?: agentOptionsTypes.GetApiKey | undefined;
  public onPayload?: aiTypes.SimpleStreamOptions["onPayload"];
  public onResponse?: aiTypes.SimpleStreamOptions["onResponse"];
  public onProviderStreamEvent?: aiTypes.SimpleStreamOptions["onProviderStreamEvent"];
  public beforeToolCall?: agentOptionsTypes.BeforeToolCall | undefined;
  public afterToolCall?: agentOptionsTypes.AfterToolCall | undefined;
  public finishTurn?: typesModule.FinishTurn | undefined;
  public prepareRequest?: typesModule.PrepareRequest | undefined;
  public prepareNextTurn?: agentOptionsTypes.PrepareNextTurn | undefined;
  public prepareNextTurnWithContext?: agentOptionsTypes.PrepareNextTurnWithContext | undefined;
  public sessionId?: string | undefined;
  public thinkingBudgets?: aiTypes.ThinkingBudgets | undefined;
  public transport: aiTypes.Transport;
  public maxRetryDelayMs?: number | undefined;
  public toolExecution: typesModule.ToolExecutionMode;

  constructor(options: agentOptionsTypes.AgentOptions) {
    const runtimeOptions: Partial<agentOptionsTypes.AgentOptions> = options ?? {};
    this.#state = createMutableAgentState(runtimeOptions.initialState);
    this.convertToLlm = runtimeOptions.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = runtimeOptions.transformContext;
    this.streamFunction = runtimeOptions.streamFn ?? getDefaultStreamFn();
    this.getApiKey = runtimeOptions.getApiKey;
    this.onPayload = runtimeOptions.onPayload;
    this.onResponse = runtimeOptions.onResponse;
    this.onProviderStreamEvent = runtimeOptions.onProviderStreamEvent;
    this.beforeToolCall = runtimeOptions.beforeToolCall;
    this.afterToolCall = runtimeOptions.afterToolCall;
    this.finishTurn = runtimeOptions.finishTurn;
    this.prepareRequest = runtimeOptions.prepareRequest;
    this.prepareNextTurn = runtimeOptions.prepareNextTurn;
    this.prepareNextTurnWithContext = runtimeOptions.prepareNextTurnWithContext;
    this.#steeringQueue = new PendingMessageQueue(runtimeOptions.steeringMode ?? "one-at-a-time");
    this.#followUpQueue = new PendingMessageQueue(runtimeOptions.followUpMode ?? "one-at-a-time");
    this.sessionId = runtimeOptions.sessionId;
    this.thinkingBudgets = runtimeOptions.thinkingBudgets;
    this.transport = runtimeOptions.transport ?? "auto";
    this.maxRetryDelayMs = runtimeOptions.maxRetryDelayMs;
    this.toolExecution = runtimeOptions.toolExecution ?? "parallel";
  }

  subscribe(listener: agentOptionsTypes.AgentListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get state(): typesModule.AgentState {
    return this.#state;
  }

  set steeringMode(mode: typesModule.QueueMode) {
    this.#steeringQueue.mode = mode;
  }

  get steeringMode(): typesModule.QueueMode {
    return this.#steeringQueue.mode;
  }

  set followUpMode(mode: typesModule.QueueMode) {
    this.#followUpQueue.mode = mode;
  }

  get followUpMode(): typesModule.QueueMode {
    return this.#followUpQueue.mode;
  }

  steer(message: typesModule.AgentMessage): void {
    this.#steeringQueue.enqueue(message, this.#queueSequence++);
  }

  followUp(message: typesModule.AgentMessage): void {
    this.#followUpQueue.enqueue(message, this.#queueSequence++);
  }

  clearSteeringQueue(): void {
    this.#steeringQueue.clear();
  }

  clearFollowUpQueue(): void {
    this.#followUpQueue.clear();
  }

  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  flushQueuedMessages(): number {
    const entries = [...this.#steeringQueue.takeAll(), ...this.#followUpQueue.takeAll()].sort(
      (a, b) => a.sequence - b.sequence,
    );
    for (const entry of entries) {
      this.#steeringQueue.enqueue(entry.message, entry.sequence);
    }
    return this.#steeringQueue.releaseAll();
  }

  hasQueuedMessages(): boolean {
    return this.#steeringQueue.hasItems() || this.#followUpQueue.hasItems();
  }

  peekQueuedMessages(): typesModule.AgentMessage[] {
    const steering = this.#steeringQueue.peek();
    return steering.length > 0 ? steering : this.#followUpQueue.peek();
  }

  get signal(): AbortSignal | undefined {
    return this.#runs.signal;
  }

  abort(): void {
    this.#runs.abort();
  }

  waitForIdle(): Promise<void> {
    return this.#runs.waitForIdle();
  }

  reset(): void {
    if (this.#runs.active) {
      throw new Error("Agent is already processing. Wait for completion before resetting.");
    }
    const baseline = getCurrentSystemMessage(this.#state.messages);
    this.#state.messages = baseline === undefined ? [] : [baseline];
    this.#state.isStreaming = false;
    this.#state.streamingMessage = undefined;
    this.#state.pendingToolCalls = new Set<string>();
    this.#state.errorMessage = undefined;
    this.clearFollowUpQueue();
    this.clearSteeringQueue();
  }

  prompt(message: typesModule.AgentMessage | typesModule.AgentMessage[]): Promise<void>;
  prompt(input: string, images?: aiTypes.ImageContent[]): Promise<void>;
  prompt(
    input: string | typesModule.AgentMessage | typesModule.AgentMessage[],
    images?: aiTypes.ImageContent[],
  ): Promise<void> {
    return Effect.runPromise(
      Effect.suspend(() =>
        this.#runs.active
          ? busy(
              "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
            )
          : this.#runPromptMessages(promptMessages({ images, input }), false),
      ),
    );
  }

  continue(): Promise<void> {
    return Effect.runPromise(Effect.suspend(() => this.#continue()));
  }

  #continue(): Effect.Effect<void> {
    if (this.#runs.active) {
      return busy("Agent is already processing. Wait for completion before continuing.");
    }
    const { messages } = this.#state;
    const lastMessage = messages.at(-1);
    if (lastMessage === undefined || messages.every((message) => message.role === "system")) {
      return busy("No messages to continue from");
    }
    if (lastMessage.role !== "assistant") return this.#runContinuation();
    const queuedSteering = this.#steeringQueue.drain();
    if (queuedSteering.length > 0) return this.#runPromptMessages(queuedSteering, true);
    const queuedFollowUps = this.#followUpQueue.drain();
    if (queuedFollowUps.length > 0) return this.#runPromptMessages(queuedFollowUps, false);
    return busy("Cannot continue from message role: assistant");
  }

  #runPromptMessages(
    messages: typesModule.AgentMessage[],
    skipInitialSteeringPoll: boolean,
  ): Effect.Effect<void> {
    return this.#runs.run((signal) =>
      runPrompt({ prompts: messages, ...this.#loopRun(signal, skipInitialSteeringPoll) }),
    );
  }

  #runContinuation(): Effect.Effect<void> {
    return this.#runs.run((signal) => runContinuation(this.#loopRun(signal, false)));
  }

  #loopRun(signal: AbortSignal, skipInitialSteeringPoll: boolean) {
    const context: typesModule.AgentContext = {
      messages: this.#state.messages.slice(),
      tools: this.#state.tools.slice(),
    };
    const config = createLoopConfig({
      ...this,
      followUps: this.#followUpQueue,
      nextTurnHooks: () => ({
        prepareNextTurn: this.prepareNextTurn,
        prepareNextTurnWithContext: this.prepareNextTurnWithContext,
      }),
      signal: () => this.signal,
      skipInitialSteeringPoll,
      state: this.#state,
      steering: this.#steeringQueue,
    });
    return {
      config,
      context,
      emit: (event: typesModule.AgentEvent) => this.#processEvent(event),
      signal,
      streamFn: this.streamFunction,
    };
  }

  #handleRunFailure(error: unknown, aborted: boolean): Effect.Effect<void> {
    const message = runFailureMessage({ aborted, error, model: this.#state.model });
    const events: typesModule.AgentEvent[] = [
      { message, type: "message_start" },
      { message, type: "message_end" },
      { message, toolResults: [], type: "turn_end" },
      { messages: [message], type: "agent_end" },
    ];
    return Effect.forEach(events, (event) => this.#processEvent(event), { discard: true });
  }

  #processEvent(event: typesModule.AgentEvent): Effect.Effect<void> {
    return Effect.suspend(() => {
      reduceAgentEvent({ event, state: this.#state });
      return notifyListeners({ event, listeners: this.#listeners, signal: this.#runs.signal });
    });
  }
}
