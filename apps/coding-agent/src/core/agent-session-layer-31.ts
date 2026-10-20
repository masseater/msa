import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer30 from "./agent-session-layer-30.ts";
import type askTypes from "./ask.types.ts";
import awaitingModule from "./awaiting.ts";
import compactionModule from "./compaction/index.ts";
import type runnerTypes from "./extensions/runner.types.ts";
import platform from "./platform.ts";
import sessionManagerSupport from "./session-manager-support.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { nowMs, toEpochMs } = platform;
const { getLatestCompactionEntry } = sessionManagerSupport;
const { shouldCompact } = compactionModule;

export default abstract class AgentSessionLayer31 extends AgentSessionLayer30 {
  protected beginRun(
    trigger: runnerTypes.BeforeAgentStartTrigger,
    mode: askTypes.PromptMode | undefined,
  ): Effect.Effect<agentTypes.AgentMessage[]> {
    return awaitingWith(function* () {
      this.isAgentRunActive = true;
      this.agentRunAbortRequested = false;
      if (mode === "ask") {
        this.loadoutBeforeAsk = this.declaredToolNames();
        this.askRun = true;
      }
      try {
        return yield* performed(this.prepareRun(trigger));
      } catch (error) {
        this.endAskRun();
        this.isAgentRunActive = false;
        this.flushPendingBashMessages();
        this.flushPendingCustomMessages();
        this.resolveIdleWaitIfIdle();
        throw error;
      }
    }, this);
  }

  protected continueRunUntilSettled(): Effect.Effect<void> {
    return awaitingWith(function* () {
      while (!this.agentRunAbortRequested) {
        if (yield* performed(this.handlePostAgentRun())) {
          if (this.agentRunAbortRequested) break;
          yield* awaited(this.agent.continue());
          continue;
        }
        if (this.agentRunAbortRequested) break;
        const continueRun =
          (yield* performed(this.runBeforeSettleBoundary())) ||
          (!this.agentRunAbortRequested && (yield* awaited(this.goalInternal.afterRun())));
        if (!continueRun || this.agentRunAbortRequested) break;
        yield* awaited(this.agent.continue());
      }
    }, this);
  }

  protected startRun(
    trigger: runnerTypes.BeforeAgentStartTrigger,
    onStarted?: () => void,
    mode?: askTypes.PromptMode,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const messages = yield* performed(this.beginRun(trigger, mode));
      this.flushPendingBashMessages();
      this.flushPendingCustomMessages();
      onStarted?.();
      this.failedResponse = undefined;
      this.recordSelection();
      this.pendingToolNames.clear();
      this.goalInternal.resetGuards();
      try {
        yield* awaited(this.agent.prompt(messages));
        yield* performed(this.continueRunUntilSettled());
      } finally {
        yield* performed(this.settleRun());
      }
    }, this);
  }

  protected prepareRun(
    trigger: runnerTypes.BeforeAgentStartTrigger,
  ): Effect.Effect<agentTypes.AgentMessage[]> {
    return awaitingWith(function* () {
      const lastAssistant = this.findLastAssistantMessage();
      if (lastAssistant !== undefined) yield* awaited(this.checkCompaction(lastAssistant, false));
      const selectedToolsBefore = this.baseSystemPromptOptions.selectedTools;
      const result = yield* awaited(
        this.extensionRunnerInternal.emitBeforeAgentStart(trigger, this.baseSystemPromptOptions),
      );
      const selected = result.systemPromptOptions.selectedTools;
      const handlerEditedTools =
        selected.length !== selectedToolsBefore.length ||
        selected.some((name, index) => name !== selectedToolsBefore[index]);
      if (!handlerEditedTools) result.systemPromptOptions.selectedTools = this.getActiveToolNames();
      const messages = yield* performed(this.triggerMessages(trigger));
      messages.push(...this.pendingNextTurnMessages);
      this.pendingNextTurnMessages = [];
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
      if (this.askRun) this.applyAskPrompt(result.systemPromptOptions);
      const updateMessage = this.preparePromptAndToolLoadout(result.systemPromptOptions);
      this.runSystemPromptOptions = result.systemPromptOptions;
      if (updateMessage !== undefined) messages.unshift(updateMessage);
      return messages;
    }, this);
  }

  protected handlePostAgentRun(): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const message = this.lastAssistantMessage;
      const toolResults = this.lastAssistantToolResults;
      this.lastAssistantMessage = undefined;
      this.lastAssistantToolResults = [];
      if (this.agentRunAbortRequested) {
        this.finishCancelledRetry();
        return false;
      }
      if (message === undefined) return this.agent.hasQueuedMessages();

      if (this.isRetryableError(message) && (yield* performed(this.prepareRetry(message)))) {
        if (this.agentRunAbortRequested) this.finishCancelledRetry();
        this.failedResponse = message;
        return !this.agentRunAbortRequested;
      }
      if (this.agentRunAbortRequested) {
        this.finishCancelledRetry();
        return false;
      }

      if (message.stopReason === "error" && this.retryAttemptInternal > 0) {
        this.emit({
          attempt: this.retryAttemptInternal,
          finalError: message.errorMessage,
          success: false,
          type: "auto_retry_end",
        });
        this.retryAttemptInternal = 0;
      }

      if (yield* awaited(this.checkCompaction(message, true, toolResults))) {
        return !this.agentRunAbortRequested;
      }

      return !this.agentRunAbortRequested && this.agent.hasQueuedMessages();
    }, this);
  }

  protected checkCompaction(
    assistantMessage: compatTypes.AssistantMessage,
    skipAbortedCheck = true,
    toolResults: agentTypes.AgentMessage[] = [],
  ): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const settings = this.settingsManager.getCompactionSettings(this.model);
        if (!settings.enabled) return false;
        if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;
        const branch = this.sessionManager.getBranch();
        const compactionEntry = getLatestCompactionEntry(branch);
        if (
          compactionEntry !== null &&
          assistantMessage.timestamp <= toEpochMs(compactionEntry.timestamp)
        )
          return false;
        const projection = this.sessionManager.buildSessionProjection();
        const overflow = this.assessOverflow(
          assistantMessage,
          projection,
          this.sessionManager.getBranch(),
        );
        if (overflow.contextOverflow || overflow.recoverableLength)
          return yield* performed(
            this.recoverFromOverflow(assistantMessage, toolResults, overflow.contextOverflow),
          );
        const contextTokens = this.measureContextTokens(
          assistantMessage,
          projection,
          branch,
          compactionEntry,
        );
        if (contextTokens === undefined) return false;
        if (shouldCompact(contextTokens, overflow.contextWindow, settings))
          return yield* awaited(this.runAutoCompaction("threshold", false));
        return false;
      }, this),
    );
  }
}
