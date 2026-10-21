import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import platform from "../platform/index.ts";

const { sleepFor } = platform;
const { retryDelayMs } = ai;
const { isContextOverflow, isRetryableAssistantError } = compat;
const { awaitingWith, performed } = awaitingModule;

export default class SessionRetry {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private retryAbortController: AbortController | undefined = undefined;

  retryAttemptInternal = 0;

  get retryAttempt(): number {
    return this.retryAttemptInternal;
  }

  abortRetry(): void {
    this.retryAbortController?.abort();
  }

  get isRetrying(): boolean {
    return this.retryAbortController !== undefined;
  }

  get autoRetryEnabled(): boolean {
    return this.session.settingsManager.session.getRetryEnabled();
  }

  setAutoRetryEnabled(enabled: boolean): void {
    this.session.settingsManager.session.setRetryEnabled(enabled);
  }

  finishCancelledRetry(): void {
    if (this.retryAttemptInternal === 0) return;
    const attempt = this.retryAttemptInternal;
    this.retryAttemptInternal = 0;
    this.session.emit({
      attempt,
      finalError: "Retry cancelled",
      success: false,
      type: "auto_retry_end",
    });
  }

  omitRecoveryAttempt(
    message: compatTypes.AssistantMessage,
    toolResults: agentTypes.AgentMessage[] = [],
  ): void {
    const targets = [message, ...toolResults];
    const targetIds = targets.map((target) =>
      this.session.context.transcript.findPersistedMessageEntryId(target),
    );
    const unresolvedProjectedTarget = targets.some(
      (target, index) =>
        targetIds[index] === undefined && this.session.agent.state.messages.includes(target),
    );
    if (unresolvedProjectedTarget) {
      throw new Error(
        "Cannot persist recovery omission because a projected message has no source entry",
      );
    }
    for (const targetId of targetIds) {
      if (targetId === undefined || targetId === "") continue;
      const editId = this.session.sessionManager.appendContextEdit(targetId, null);
      const entry = this.session.sessionManager.getEntry(editId);
      if (entry !== undefined) this.session.emit({ entry, type: "entry_appended" });
    }
    this.session.context.transcript.refreshFinalizedContext();
  }

  summarizationRetryCallbacks(
    source:
      | { source: "branchSummary" }
      | { source: "compaction"; reason: "manual" | "threshold" | "overflow" },
  ): compatTypes.RetryCallbacks {
    return {
      onRetryAttemptStart: () => {
        this.session.emit({
          type: "summarization_retry_attempt_start",
          ...source,
        });
      },
      onRetryFinished: () => {
        this.session.emit({ type: "summarization_retry_finished" });
      },
      onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
        this.session.emit({
          attempt,
          delayMs,
          errorMessage,
          maxAttempts,
          type: "summarization_retry_scheduled",
        });
      },
    };
  }

  willRetryAfterAgentEnd(event: Extract<agentTypes.AgentEvent, { type: "agent_end" }>): boolean {
    if (this.session.run.lifecycle.agentRunAbortRequested) return false;
    const settings = this.session.settingsManager.session.getRetrySettings();
    if (!settings.enabled || this.retryAttemptInternal >= settings.maxRetries) {
      return false;
    }

    for (let i = event.messages.length - 1; i >= 0; i--) {
      const message = event.messages[i];
      if (message?.role === "assistant") {
        return this.isRetryableError(message as compatTypes.AssistantMessage);
      }
    }
    return false;
  }

  isRetryableError(message: compatTypes.AssistantMessage): boolean {
    if (
      isContextOverflow(
        message,
        (this.session.models.selection.modelForMessage(message) ?? this.session.model)
          ?.contextWindow ?? 0,
      )
    )
      return false;
    return isRetryableAssistantError(message);
  }

  prepareRetry(message: compatTypes.AssistantMessage): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const settings = this.session.settingsManager.session.getRetrySettings();
      if (!settings.enabled) {
        return false;
      }

      this.retryAttemptInternal++;

      if (this.retryAttemptInternal > settings.maxRetries) {
        this.retryAttemptInternal--;
        return false;
      }

      const delayMs = retryDelayMs(settings, this.retryAttemptInternal);

      this.session.emit({
        attempt: this.retryAttemptInternal,
        delayMs,
        errorMessage: message.errorMessage || "Unknown error",
        maxAttempts: settings.maxRetries,
        type: "auto_retry_start",
      });

      this.omitRecoveryAttempt(message);

      this.retryAbortController = new AbortController();
      try {
        yield* performed(sleepFor(delayMs, this.retryAbortController.signal));
      } catch {
        this.finishCancelledRetry();
        return false;
      } finally {
        this.retryAbortController = undefined;
      }

      return true;
    }, this);
  }
}
