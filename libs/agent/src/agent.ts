import {
  getCurrentSystemMessage,
  type ImageContent,
  type SimpleStreamOptions,
  type ThinkingBudgets,
  type Transport,
} from "@msa/ai";
import { Effect } from "effect";

import { createLoopConfig } from "./agent-config.ts";
import type {
  AfterToolCall,
  AgentListener,
  AgentOptions,
  BeforeToolCall,
  ConvertToLlm,
  GetApiKey,
  PrepareNextTurn,
  PrepareNextTurnWithContext,
  TransformContext,
} from "./agent-options.ts";
import { AgentRuns, busy, notifyListeners } from "./agent-run.ts";
import {
  createMutableAgentState,
  defaultConvertToLlm,
  type MutableAgentState,
  promptMessages,
  reduceAgentEvent,
  runFailureMessage,
} from "./agent-state.ts";
import { runContinuation, runPrompt } from "./loop-run.ts";
import { PendingMessageQueue } from "./pending-queue.ts";
import { getDefaultStreamFn } from "./stream-fn.ts";
import type {
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentState,
  FinishTurn,
  PrepareRequest,
  QueueMode,
  StreamFn,
  ToolExecutionMode,
} from "./types.ts";

export type { AgentOptions } from "./agent-options.ts";
export type { AgentInitialState } from "./agent-state.ts";
export type { QueueMode } from "./types.ts";

export class Agent {
  readonly #state: MutableAgentState;
  readonly #listeners = new Set<AgentListener>();
  readonly #steeringQueue: PendingMessageQueue;
  readonly #followUpQueue: PendingMessageQueue;
  #queueSequence = 0;
  readonly #runs = new AgentRuns({
    onStart: () => {
      this.#state.isStreaming = true;
      this.#state.streamingMessage = undefined;
      this.#state.errorMessage = undefined;
    },
    onFailure: (error, aborted) => this.#handleRunFailure(error, aborted),
    onFinish: () => {
      this.#state.isStreaming = false;
      this.#state.streamingMessage = undefined;
      this.#state.pendingToolCalls = new Set<string>();
    },
  });

  public convertToLlm: ConvertToLlm;
  public transformContext?: TransformContext | undefined;
  public streamFunction: StreamFn;
  public getApiKey?: GetApiKey | undefined;
  public onPayload?: SimpleStreamOptions["onPayload"];
  public onResponse?: SimpleStreamOptions["onResponse"];
  public onProviderStreamEvent?: SimpleStreamOptions["onProviderStreamEvent"];
  public beforeToolCall?: BeforeToolCall | undefined;
  public afterToolCall?: AfterToolCall | undefined;
  public finishTurn?: FinishTurn | undefined;
  public prepareRequest?: PrepareRequest | undefined;
  public prepareNextTurn?: PrepareNextTurn | undefined;
  public prepareNextTurnWithContext?: PrepareNextTurnWithContext | undefined;
  public sessionId?: string | undefined;
  public thinkingBudgets?: ThinkingBudgets | undefined;
  public transport: Transport;
  public maxRetryDelayMs?: number | undefined;
  public toolExecution: ToolExecutionMode;

  constructor(options: AgentOptions) {
    const runtimeOptions: Partial<AgentOptions> = options ?? {};
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

  subscribe(listener: AgentListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get state(): AgentState {
    return this.#state;
  }

  set steeringMode(mode: QueueMode) {
    this.#steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.#steeringQueue.mode;
  }

  set followUpMode(mode: QueueMode) {
    this.#followUpQueue.mode = mode;
  }

  get followUpMode(): QueueMode {
    return this.#followUpQueue.mode;
  }

  steer(message: AgentMessage): void {
    this.#steeringQueue.enqueue(message, this.#queueSequence++);
  }

  followUp(message: AgentMessage): void {
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

  peekQueuedMessages(): AgentMessage[] {
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

  prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  prompt(input: string, images?: ImageContent[]): Promise<void>;
  prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
    return Effect.runPromise(
      Effect.suspend(() =>
        this.#runs.active
          ? busy(
              "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
            )
          : this.#runPromptMessages(promptMessages({ input, images }), false),
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
    messages: AgentMessage[],
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
    const context: AgentContext = {
      messages: this.#state.messages.slice(),
      tools: this.#state.tools.slice(),
    };
    const config = createLoopConfig({
      ...this,
      state: this.#state,
      steering: this.#steeringQueue,
      followUps: this.#followUpQueue,
      signal: () => this.signal,
      skipInitialSteeringPoll,
      nextTurnHooks: () => ({
        prepareNextTurn: this.prepareNextTurn,
        prepareNextTurnWithContext: this.prepareNextTurnWithContext,
      }),
    });
    return {
      context,
      config,
      emit: (event: AgentEvent) => this.#processEvent(event),
      signal,
      streamFn: this.streamFunction,
    };
  }

  #handleRunFailure(error: unknown, aborted: boolean): Effect.Effect<void> {
    const message = runFailureMessage({ model: this.#state.model, error, aborted });
    const events: AgentEvent[] = [
      { type: "message_start", message },
      { type: "message_end", message },
      { type: "turn_end", message, toolResults: [] },
      { type: "agent_end", messages: [message] },
    ];
    return Effect.forEach(events, (event) => this.#processEvent(event), { discard: true });
  }

  #processEvent(event: AgentEvent): Effect.Effect<void> {
    return Effect.suspend(() => {
      reduceAgentEvent({ state: this.#state, event });
      return notifyListeners({ listeners: this.#listeners, event, signal: this.#runs.signal });
    });
  }
}
