import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import type askTypes from "../ask.types.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import type runnerTypes from "../extensions/runner.types.ts";
import platform from "../platform/index.ts";

const { makeLatch, nowMs } = platform;
const { awaited, awaitingWith, performed } = awaitingModule;

export default class SessionRunLifecycle {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  isAgentRunActive = false;

  agentRunAbortRequested = false;

  private idleWaitPromise: Promise<void> | undefined;

  private resolveIdleWait: (() => void) | undefined;

  failedResponse: compatTypes.AssistantMessage | undefined;

  lastAssistantMessage: compatTypes.AssistantMessage | undefined;

  lastAssistantToolResults: agentTypes.AgentMessage[] = [];

  lastActivityOutcome: extensionsTypes.AgentActivityOutcome = "completed";

  isBeforeSettle = false;

  abortDuringBeforeSettle = false;

  isEmittingAgentSettled = false;

  readonly deferredSettledActions: Array<() => Promise<void>> = [];

  resolveIdleWaitIfIdle(): void {
    if (!this.session.isIdle || this.resolveIdleWait === undefined) {
      return;
    }
    const resolve = this.resolveIdleWait;
    this.idleWaitPromise = undefined;
    this.resolveIdleWait = undefined;
    resolve();
  }

  private getIdleWaitPromise(): Promise<void> {
    if (this.idleWaitPromise === undefined) {
      const latch = makeLatch();
      this.resolveIdleWait = latch.open;
      this.idleWaitPromise = latch.promise;
    }
    return this.idleWaitPromise;
  }

  private emitAgentSettled(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.session.models.cacheWarming.cacheWarmer?.onAgentSettled();
      this.isAgentRunActive = false;
      this.isEmittingAgentSettled = true;
      try {
        const aborted = this.agentRunAbortRequested;
        yield* awaited(
          this.session.extensions.binding.extensionRunnerInternal.emit({
            aborted,
            type: "agent_settled",
          }),
        );
        this.session.emit({ aborted, type: "agent_settled" });
      } finally {
        this.isEmittingAgentSettled = false;
      }

      const deferred = this.deferredSettledActions.splice(0);
      if (deferred.length > 0) {
        try {
          for (const action of deferred) yield* awaited(action());
        } finally {
          this.resolveIdleWaitIfIdle();
        }
        return;
      }
      this.resolveIdleWaitIfIdle();
    }, this);
  }

  abort(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isAgentRunActive) {
          this.agentRunAbortRequested = true;
        }
        this.session.run.retry.abortRetry();
        this.session.compaction.manual.abortCompaction();
        this.session.context.tree.abortBranchSummary();
        this.session.integrations.goal.goalInternal.abort();
        if (this.isBeforeSettle) this.abortDuringBeforeSettle = true;
        this.session.agent.abort();
        yield* awaited(this.waitForIdle());
      }, this),
    );
  }

  waitForIdle(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.session.isIdle) {
          return;
        }
        yield* awaited(this.getIdleWaitPromise());
      }, this),
    );
  }

  private settleRun(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.agentRunAbortRequested) this.session.run.retry.finishCancelledRetry();
      this.failedResponse = undefined;
      this.session.tools.prompt.runSystemPromptOptions = undefined;
      this.session.tools.ask.endAskRun();
      this.session.context.bash.flushPendingBashMessages();
      this.session.run.prompting.flushPendingCustomMessages();
      yield* performed(this.emitAgentSettled());
    }, this);
  }

  private beginRun(
    trigger: runnerTypes.BeforeAgentStartTrigger,
    mode: askTypes.PromptMode | undefined,
  ): Effect.Effect<agentTypes.AgentMessage[]> {
    return awaitingWith(function* () {
      this.isAgentRunActive = true;
      this.agentRunAbortRequested = false;
      if (mode === "ask") {
        this.session.tools.ask.loadoutBeforeAsk = this.session.tools.loadout.declaredToolNames();
        this.session.tools.ask.askRun = true;
      }
      try {
        return yield* performed(this.prepareRun(trigger));
      } catch (error) {
        this.session.tools.ask.endAskRun();
        this.isAgentRunActive = false;
        this.session.context.bash.flushPendingBashMessages();
        this.session.run.prompting.flushPendingCustomMessages();
        this.resolveIdleWaitIfIdle();
        throw error;
      }
    }, this);
  }

  private continueRunUntilSettled(): Effect.Effect<void> {
    return awaitingWith(function* () {
      while (!this.agentRunAbortRequested) {
        if (yield* performed(this.handlePostAgentRun())) {
          if (this.agentRunAbortRequested) break;
          yield* awaited(this.session.agent.continue());
          continue;
        }
        if (this.agentRunAbortRequested) break;
        const continueRun =
          (yield* performed(this.session.run.boundary.runBeforeSettleBoundary())) ||
          (!this.agentRunAbortRequested &&
            (yield* awaited(this.session.integrations.goal.goalInternal.afterRun())));
        if (!continueRun || this.agentRunAbortRequested) break;
        yield* awaited(this.session.agent.continue());
      }
    }, this);
  }

  startRun(
    trigger: runnerTypes.BeforeAgentStartTrigger,
    onStarted?: () => void,
    mode?: askTypes.PromptMode,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const messages = yield* performed(this.beginRun(trigger, mode));
      this.session.context.bash.flushPendingBashMessages();
      this.session.run.prompting.flushPendingCustomMessages();
      onStarted?.();
      this.failedResponse = undefined;
      this.session.models.selection.recordSelection();
      this.session.tools.loadout.pendingToolNames.clear();
      this.session.integrations.goal.goalInternal.resetGuards();
      try {
        yield* awaited(this.session.agent.prompt(messages));
        yield* performed(this.continueRunUntilSettled());
      } finally {
        yield* performed(this.settleRun());
      }
    }, this);
  }

  private prepareRun(
    trigger: runnerTypes.BeforeAgentStartTrigger,
  ): Effect.Effect<agentTypes.AgentMessage[]> {
    return awaitingWith(function* () {
      const lastAssistant = this.session.context.transcript.findLastAssistantMessage();
      if (lastAssistant !== undefined)
        yield* awaited(this.session.compaction.auto.checkCompaction(lastAssistant, false));
      const selectedToolsBefore = this.session.tools.prompt.baseSystemPromptOptions.selectedTools;
      const result = yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emitBeforeAgentStart(
          trigger,
          this.session.tools.prompt.baseSystemPromptOptions,
        ),
      );
      const selected = result.systemPromptOptions.selectedTools;
      const handlerEditedTools =
        selected.length !== selectedToolsBefore.length ||
        selected.some((name, index) => name !== selectedToolsBefore[index]);
      if (!handlerEditedTools)
        result.systemPromptOptions.selectedTools = this.session.tools.loadout.getActiveToolNames();
      const messages = yield* performed(this.session.run.triggers.triggerMessages(trigger));
      messages.push(...this.session.run.prompting.pendingNextTurnMessages);
      this.session.run.prompting.pendingNextTurnMessages = [];
      for (const msg of result.messages) {
        messages.push({
          content: msg.content ?? [],
          customType: msg.customType,
          details: msg.details,
          display: msg.display,
          role: "custom",
          timestamp: nowMs(),
        });
      }
      if (this.session.tools.ask.askRun)
        this.session.tools.ask.applyAskPrompt(result.systemPromptOptions);
      const updateMessage = this.session.tools.loadout.preparePromptAndToolLoadout(
        result.systemPromptOptions,
      );
      this.session.tools.prompt.runSystemPromptOptions = result.systemPromptOptions;
      if (updateMessage !== undefined) messages.unshift(updateMessage);
      return messages;
    }, this);
  }

  private handlePostAgentRun(): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const message = this.lastAssistantMessage;
      const toolResults = this.lastAssistantToolResults;
      this.lastAssistantMessage = undefined;
      this.lastAssistantToolResults = [];
      if (this.agentRunAbortRequested) {
        this.session.run.retry.finishCancelledRetry();
        return false;
      }
      if (message === undefined) return this.session.agent.hasQueuedMessages();

      if (
        this.session.run.retry.isRetryableError(message) &&
        (yield* performed(this.session.run.retry.prepareRetry(message)))
      ) {
        if (this.agentRunAbortRequested) this.session.run.retry.finishCancelledRetry();
        this.failedResponse = message;
        return !this.agentRunAbortRequested;
      }
      if (this.agentRunAbortRequested) {
        this.session.run.retry.finishCancelledRetry();
        return false;
      }

      if (message.stopReason === "error" && this.session.run.retry.retryAttemptInternal > 0) {
        this.session.emit({
          attempt: this.session.run.retry.retryAttemptInternal,
          finalError: message.errorMessage,
          success: false,
          type: "auto_retry_end",
        });
        this.session.run.retry.retryAttemptInternal = 0;
      }

      if (yield* performed(this.session.run.fallback.afterResponse(message)))
        return !this.agentRunAbortRequested;

      if (
        yield* awaited(this.session.compaction.auto.checkCompaction(message, true, toolResults))
      ) {
        return !this.agentRunAbortRequested;
      }

      return !this.agentRunAbortRequested && this.session.agent.hasQueuedMessages();
    }, this);
  }
}
