import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import AgentSessionLayer5 from "./agent-session-layer-5.ts";
import MemoryService from "./memory/memory-service.ts";
import virtualModels from "./virtual-models.ts";

const { isVirtualModel } = virtualModels;

export default abstract class AgentSessionLayer6 extends AgentSessionLayer5 {
  protected modelForMessage(
    message: compatTypes.AssistantMessage,
  ): compatTypes.Model<any> | undefined {
    const model = this.model;
    if (model !== undefined && isVirtualModel(model))
      return this.modelRuntimeInternal.getPhysicalModel(message.provider, message.model);
    return model?.provider === message.provider && model.id === message.model ? model : undefined;
  }

  protected emitToolResultHook(
    { toolCall, args, result, isError }: agentTypes.AfterToolCallContext,
    parentToolCallId: string | undefined,
  ) {
    const runner = this.extensionRunnerInternal;
    if (!runner.hasHandlers("tool_result")) return Promise.resolve(undefined);
    return runner.emitToolResult({
      content: result.content,
      details: result.details,
      input: args as Record<string, unknown>,
      isError,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      type: "tool_result",
      usage: result.usage,
      ...(parentToolCallId !== undefined && parentToolCallId !== "" ? { parentToolCallId } : {}),
      ...(result.structuredContent === undefined
        ? {}
        : { structuredContent: result.structuredContent }),
    });
  }

  protected persistMessage(message: agentTypes.AgentMessage): void {
    let entryId: string | undefined;
    if (message.role === "custom") {
      entryId = this.sessionManager.appendCustomMessageEntry(
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
      entryId = this.sessionManager.appendMessage(message);
    }
    if (entryId !== undefined && entryId !== "") this.entryIdsByMessage.set(message, entryId);
    if (message.role !== "assistant") return;
    const assistantMsg = message as compatTypes.AssistantMessage;
    this.lastAssistantMessage = assistantMsg;
    if (assistantMsg.stopReason !== "error" && assistantMsg.stopReason !== "length")
      this.overflowRecoveryAttempted = false;
    if (assistantMsg.stopReason !== "error" && this.retryAttemptInternal > 0) {
      this.emit({ attempt: this.retryAttemptInternal, success: true, type: "auto_retry_end" });
      this.retryAttemptInternal = 0;
    }
  }

  protected findPersistedMessageEntryId(message: agentTypes.AgentMessage): string | undefined {
    const mapped = this.entryIdsByMessage.get(message);
    if (mapped !== undefined && mapped !== "") return mapped;
    for (const entry of [...this.sessionManager.getBranch()].reverse()) {
      if (entry.type === "message" && entry.message === message) return entry.id;
    }

    const messageIndex = this.agent.state.messages.indexOf(message);
    if (messageIndex < 0) return undefined;
    const projection = this.sessionManager.buildSessionProjection();
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

  protected omitRecoveryAttempt(
    message: compatTypes.AssistantMessage,
    toolResults: agentTypes.AgentMessage[] = [],
  ): void {
    const targets = [message, ...toolResults];
    const targetIds = targets.map((target) => this.findPersistedMessageEntryId(target));
    const unresolvedProjectedTarget = targets.some(
      (target, index) =>
        targetIds[index] === undefined && this.agent.state.messages.includes(target),
    );
    if (unresolvedProjectedTarget) {
      throw new Error(
        "Cannot persist recovery omission because a projected message has no source entry",
      );
    }
    for (const targetId of targetIds) {
      if (targetId === undefined || targetId === "") continue;
      const editId = this.sessionManager.appendContextEdit(targetId, null);
      const entry = this.sessionManager.getEntry(editId);
      if (entry !== undefined) this.emit({ entry, type: "entry_appended" });
    }
    this.refreshFinalizedContext();
  }

  protected findLastAssistantMessage(): compatTypes.AssistantMessage | undefined {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === "assistant") {
        return msg as compatTypes.AssistantMessage;
      }
    }
    return undefined;
  }

  protected replaceMessageInPlace(
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

  getCallableToolNames(): string[] {
    return this.getCallableTools().map((t) => t.name);
  }

  protected getCallableTools(
    active: ReadonlySet<string> = new Set(this.declaredToolNames()),
  ): agentTypes.AgentTool[] {
    return [...this.toolRegistry.values()].filter((tool) => {
      const exposure = this.getToolExposure(tool.name);
      return (
        exposure === "codemode" ||
        exposure === "deferred" ||
        (exposure === "direct" && active.has(tool.name))
      );
    });
  }

  get scopedModels(): ReadonlyArray<{
    model: compatTypes.Model<any>;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  }> {
    return this.scopedModelsInternal;
  }

  setScopedModels(
    scopedModels: Array<{
      model: compatTypes.Model<any>;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    }>,
  ): void {
    this.scopedModelsInternal = scopedModels;
  }

  protected registrationActivations(
    options:
      | { activeToolNames?: string[]; includeAllExtensionTools?: boolean | undefined }
      | undefined,
    previousActivatedOnRegistration: ReadonlySet<string>,
    wrappedExtensionTools: agentTypes.AgentTool[],
  ): string[] {
    const allowedTools = this.allowedTools;
    if (allowedTools !== undefined)
      return [...this.toolRegistry.keys()].filter(
        (toolName) => allowedTools(toolName) && this.isDeclarable(toolName),
      );
    if (options?.includeAllExtensionTools === true)
      return wrappedExtensionTools
        .filter((tool) => this.isActivatedOnRegistration(tool.name))
        .map((tool) => tool.name);
    if (options?.activeToolNames !== undefined) return [];
    return [...this.toolRegistry.keys()].filter(
      (toolName) =>
        !previousActivatedOnRegistration.has(toolName) && this.isActivatedOnRegistration(toolName),
    );
  }

  protected resetMemory(): void {
    const memorySettings = this.settingsManager.getMemorySettings();
    void this.memoryInternal?.close();
    this.memoryInternal = memorySettings.enabled
      ? new MemoryService({ cwd: this.cwd, settings: memorySettings })
      : undefined;
    this.memoryInternal?.warm();
  }

  protected summarizationRetryCallbacks(
    source:
      | { source: "branchSummary" }
      | { source: "compaction"; reason: "manual" | "threshold" | "overflow" },
  ): compatTypes.RetryCallbacks {
    return {
      onRetryAttemptStart: () => {
        this.emit({
          type: "summarization_retry_attempt_start",
          ...source,
        });
      },
      onRetryFinished: () => {
        this.emit({ type: "summarization_retry_finished" });
      },
      onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
        this.emit({
          attempt,
          delayMs,
          errorMessage,
          maxAttempts,
          type: "summarization_retry_scheduled",
        });
      },
    };
  }

  getLastAssistantText(): string | undefined {
    const lastAssistant = this.messages
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
}
