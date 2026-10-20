import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";

import type AgentSession from "../agent-session.ts";
const { contentText } = ai;

export default class SessionTranscript {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private readonly entryIdsByMessage = new WeakMap<object, string>();

  refreshFinalizedContext(): void {
    const projection = this.session.sessionManager.buildSessionProjection();
    for (const entry of projection.entries) {
      for (const message of entry.messages)
        this.entryIdsByMessage.set(message, entry.sourceEntry.id);
    }
    this.session.agent.state.messages = projection.messages;
  }

  setSessionName(name: string): void {
    this.session.sessionManager.appendSessionInfo(name);
    const event = {
      name: this.session.sessionManager.getSessionName(),
      type: "session_info_changed",
    } as const;
    this.session.emit(event);
    void this.session.extensions.binding.extensionRunnerInternal.emit(event);
  }

  persistMessage(message: agentTypes.AgentMessage): void {
    let entryId: string | undefined;
    if (message.role === "custom") {
      entryId = this.session.sessionManager.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details,
      );
    } else if (
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
    ) {
      entryId = this.session.sessionManager.appendMessage(message);
    }
    if (entryId !== undefined && entryId !== "") this.entryIdsByMessage.set(message, entryId);
    if (message.role !== "assistant") return;
    const assistantMsg = message as compatTypes.AssistantMessage;
    this.session.run.lifecycle.lastAssistantMessage = assistantMsg;
    if (assistantMsg.stopReason !== "error" && assistantMsg.stopReason !== "length")
      this.session.compaction.overflow.overflowRecoveryAttempted = false;
    if (assistantMsg.stopReason !== "error" && this.session.run.retry.retryAttemptInternal > 0) {
      this.session.emit({
        attempt: this.session.run.retry.retryAttemptInternal,
        success: true,
        type: "auto_retry_end",
      });
      this.session.run.retry.retryAttemptInternal = 0;
    }
  }

  findPersistedMessageEntryId(message: agentTypes.AgentMessage): string | undefined {
    const mapped = this.entryIdsByMessage.get(message);
    if (mapped !== undefined && mapped !== "") return mapped;
    for (const entry of [...this.session.sessionManager.getBranch()].reverse()) {
      if (entry.type === "message" && entry.message === message) return entry.id;
    }

    const messageIndex = this.session.agent.state.messages.indexOf(message);
    if (messageIndex < 0) return undefined;
    const projection = this.session.sessionManager.buildSessionProjection();
    let projectedIndex = 0;
    for (const entry of projection.entries) {
      for (let i = 0; i < entry.messages.length; i++) {
        if (projectedIndex === messageIndex) {
          this.entryIdsByMessage.set(message, entry.sourceEntry.id);
          return entry.sourceEntry.id;
        }
        projectedIndex++;
      }
    }
    return undefined;
  }

  findLastAssistantMessage(): compatTypes.AssistantMessage | undefined {
    const messages = this.session.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === "assistant") {
        return msg as compatTypes.AssistantMessage;
      }
    }
    return undefined;
  }

  replaceMessageInPlace(
    target: agentTypes.AgentMessage,
    replacement: agentTypes.AgentMessage,
  ): void {
    if (target === replacement) {
      return;
    }

    const targetRecord = target as unknown as Record<string, unknown>;
    for (const key of Object.keys(targetRecord)) {
      delete targetRecord[key];
    }
    Object.assign(targetRecord, replacement);
  }

  getLastAssistantText(): string | undefined {
    const lastAssistant = this.session.messages
      .slice()
      .reverse()
      .find((m) => {
        if (m.role !== "assistant") return false;
        const msg = m as compatTypes.AssistantMessage;
        if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
        return true;
      });

    if (lastAssistant === undefined) return undefined;

    let text = "";
    for (const content of (lastAssistant as compatTypes.AssistantMessage).content) {
      if (content.type === "text") {
        text += content.text;
      }
    }

    return text.trim() || undefined;
  }

  getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
    const entries = this.session.sessionManager.getEntries();
    const result: Array<{ entryId: string; text: string }> = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      if (entry.message.role !== "user") continue;

      const text = contentText(entry.message.content, "");
      if (text !== "") {
        result.push({ entryId: entry.id, text });
      }
    }

    return result;
  }
}
