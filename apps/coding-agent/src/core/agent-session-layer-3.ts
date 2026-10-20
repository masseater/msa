import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import AgentSessionLayer2 from "./agent-session-layer-2.ts";

export default abstract class AgentSessionLayer3 extends AgentSessionLayer2 {
  protected refreshFinalizedContext(): void {
    const projection = this.sessionManager.buildSessionProjection();
    for (const entry of projection.entries) {
      for (const message of entry.messages)
        this.entryIdsByMessage.set(message, entry.sourceEntry.id);
    }
    this.agent.state.messages = projection.messages;
  }

  protected getPendingBoundaryMessages(): agentTypes.AgentMessage[] {
    return [...this.agent.peekQueuedMessages(), ...this.pendingCustomMessages];
  }

  protected reportInvalidBoundaryContinuation(event: "turn_end" | "agent_before_settle"): void {
    this.extensionRunnerInternal.emitError({
      error: `${event} requested continuation without runnable model context`,
      event,
      extensionPath: "<boundary>",
    });
  }

  protected resolveIdleWaitIfIdle(): void {
    if (!this.isIdle || this.resolveIdleWait === undefined) {
      return;
    }
    const resolve = this.resolveIdleWait;
    this.idleWaitPromise = undefined;
    this.resolveIdleWait = undefined;
    resolve();
  }

  protected disconnectFromAgent(): void {
    if (this.unsubscribeAgent !== undefined) {
      this.unsubscribeAgent();
      this.unsubscribeAgent = undefined;
    }
  }

  refreshContext(): void {
    this.refreshFinalizedContext();
  }

  get state(): agentTypes.AgentState {
    return this.agent.state;
  }

  get model(): compatTypes.Model<any> | undefined {
    return this.agent.state.model;
  }

  get thinkingLevel(): agentTypes.ThinkingLevel {
    return this.agent.state.thinkingLevel;
  }

  get isStreaming(): boolean {
    return this.isAgentRunActive;
  }

  get isIdle(): boolean {
    return !this.isAgentRunActive && !this.isCompacting;
  }

  get retryAttempt(): number {
    return this.retryAttemptInternal;
  }

  getActiveToolNames(): string[] {
    return this.askRun ? [...this.loadoutBeforeAsk] : this.declaredToolNames();
  }

  protected declaredToolNames(): string[] {
    return this.agent.state.tools.map((t) => t.name);
  }

  get isCompacting(): boolean {
    return (
      this.autoCompactionAbortController !== undefined ||
      this.compactionAbortController !== undefined ||
      this.branchSummaryAbortController !== undefined
    );
  }

  get messages(): agentTypes.AgentMessage[] {
    return this.agent.state.messages;
  }

  get steeringMode(): "all" | "one-at-a-time" {
    return this.agent.steeringMode;
  }

  get followUpMode(): "all" | "one-at-a-time" {
    return this.agent.followUpMode;
  }

  get sessionFile(): string | undefined {
    return this.sessionManager.getSessionFile();
  }

  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }

  get sessionName(): string | undefined {
    return this.sessionManager.getSessionName();
  }

  protected normalizePromptSnippet(text: string | undefined): string | undefined {
    if (text === undefined || text === "") return undefined;
    const oneLine = text
      .replace(/[\r\n]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    return oneLine.length > 0 ? oneLine : undefined;
  }

  protected normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
    if (guidelines === undefined || guidelines.length === 0) {
      return [];
    }

    const unique = new Set<string>();
    for (const guideline of guidelines) {
      const normalized = guideline.trim();
      if (normalized.length > 0) {
        unique.add(normalized);
      }
    }
    return Array.from(unique);
  }

  get pendingMessageCount(): number {
    return this.steeringMessages.length + this.followUpMessages.length;
  }

  getSteeringMessages(): readonly string[] {
    return this.steeringMessages;
  }

  getFollowUpMessages(): readonly string[] {
    return this.followUpMessages;
  }

  setGoal(condition: string): void {
    this.goalInternal.set(condition);
  }

  clearGoal(): boolean {
    return this.goalInternal.clear();
  }

  supportsThinking(): boolean {
    return this.model?.reasoning === true;
  }

  protected syncQueueModesFromSettings(): void {
    this.agent.steeringMode = this.settingsManager.getSteeringMode();
    this.agent.followUpMode = this.settingsManager.getFollowUpMode();
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.agent.steeringMode = mode;
    this.settingsManager.setSteeringMode(mode);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.agent.followUpMode = mode;
    this.settingsManager.setFollowUpMode(mode);
  }

  protected clearManualCompactionState(): void {
    this.compactionAbortController = undefined;
    this.resolveIdleWaitIfIdle();
  }

  abortCompaction(): void {
    this.compactionAbortController?.abort();
    this.autoCompactionAbortController?.abort();
  }

  abortBranchSummary(): void {
    this.branchSummaryAbortController?.abort();
  }

  setAutoCompactionEnabled(enabled: boolean): void {
    this.settingsManager.setCompactionEnabled(enabled);
  }

  get autoCompactionEnabled(): boolean {
    return this.settingsManager.getCompactionEnabled();
  }

  abortRetry(): void {
    this.retryAbortController?.abort();
  }

  get isRetrying(): boolean {
    return this.retryAbortController !== undefined;
  }

  get autoRetryEnabled(): boolean {
    return this.settingsManager.getRetryEnabled();
  }

  setAutoRetryEnabled(enabled: boolean): void {
    this.settingsManager.setRetryEnabled(enabled);
  }

  abortBash(): void {
    for (const abortController of [...this.bashAbortControllers]) {
      abortController.abort();
    }
  }

  get isBashRunning(): boolean {
    return this.bashAbortControllers.size > 0;
  }

  get hasPendingBashMessages(): boolean {
    return this.pendingBashMessages.length > 0;
  }

  protected flushPendingBashMessages(): void {
    if (this.pendingBashMessages.length === 0) return;

    for (const bashMessage of this.pendingBashMessages) {
      this.sessionManager.appendMessage(bashMessage);
    }
    this.pendingBashMessages = [];
    this.refreshFinalizedContext();
  }

  protected assertTreeNavigable(): void {
    if (this.isStreaming) {
      throw new Error(
        "Wait for the current response to finish before navigating the session tree.",
      );
    }
    if (this.isCompacting) {
      throw new Error(
        "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
      );
    }
  }

  hasExtensionHandlers(eventType: string): boolean {
    return this.extensionRunnerInternal.hasHandlers(eventType);
  }
}
