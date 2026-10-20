import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer6 from "./agent-session-layer-6.ts";
import ask from "./ask.ts";
import defaultsModule from "./defaults.ts";
import type messagesTypes from "./messages.types.ts";
import virtualModels from "./virtual-models.ts";

const { findLatestResponse, getBranchSelection, isVirtualModel } = virtualModels;
const { contentText } = ai;
const {
  clampThinkingLevel,
  cleanupSessionResources,
  getSupportedThinkingLevels,
  isContextOverflow,
  isRetryableAssistantError,
  modelsAreEqual,
} = compat;
const { askDefinition } = ask;
const { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } = defaultsModule;

export default abstract class AgentSessionLayer7 extends AgentSessionLayer6 {
  protected recordSelection(): void {
    const model = this.model;
    if (model === undefined) return;
    const getModel = (provider: string, modelId: string) =>
      this.modelRuntimeInternal.getModel(provider, modelId);
    const recorded = getBranchSelection(this.sessionManager.getBranch(), getModel);
    if (
      recorded === undefined ||
      (recorded.provider === model.provider && recorded.modelId === model.id)
    )
      return;
    const recordedModel = getModel(recorded.provider, recorded.modelId);
    if (!isVirtualModel(model) && (recordedModel && isVirtualModel(recordedModel)) !== true) return;
    this.sessionManager.appendModelChange(model.provider, model.id);
  }

  protected limitsModel(): compatTypes.Model<any> | undefined {
    return this.routedModel?.model ?? this.model;
  }

  protected dequeueDeliveredUserMessage(message: agentTypes.AgentMessage): void {
    this.overflowRecoveryAttempted = false;
    const messageText = contentText((message as compatTypes.UserMessage).content, "");
    if (messageText === "") return;
    const steeringIndex = this.steeringMessages.indexOf(messageText);
    if (steeringIndex !== -1) {
      this.steeringMessages.splice(steeringIndex, 1);
      this.emitQueueUpdate();
      return;
    }
    const followUpIndex = this.followUpMessages.indexOf(messageText);
    if (followUpIndex === -1) return;
    this.followUpMessages.splice(followUpIndex, 1);
    this.emitQueueUpdate();
  }

  protected willRetryAfterAgentEnd(
    event: Extract<agentTypes.AgentEvent, { type: "agent_end" }>,
  ): boolean {
    if (this.agentRunAbortRequested) return false;
    const settings = this.settingsManager.getRetrySettings();
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

  dispose(): Promise<void> {
    try {
      this.abortRetry();
      this.abortCompaction();
      this.abortBranchSummary();
      this.abortBash();
      this.goalInternal.abort();
      this.agent.abort();
    } catch {}
    const closing = Promise.all([
      this.orchestratorInternal?.dispose().catch(() => undefined),
      Promise.resolve(this.prWatchInternal.dispose()).catch(() => undefined),
      this.memoryInternal?.close(),
    ]).then(() => undefined);
    this.memoryInternal = undefined;

    this.extensionRunnerInternal.invalidate(
      "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
    );
    this.disconnectFromAgent();
    this.telemetry.close();
    this.eventListeners = [];
    if (this.cacheWarmer !== undefined) {
      this.cacheWarmer.onWarmed = undefined;
      this.cacheWarmer.cancel();
    }
    cleanupSessionResources(this.sessionId);
    return closing;
  }

  get routedModel():
    | { model: compatTypes.Model<any>; thinkingLevel?: agentTypes.ThinkingLevel | undefined }
    | undefined {
    if (this.model === undefined || !isVirtualModel(this.model)) return undefined;
    const latest = findLatestResponse(this.agent.state.messages);
    const model =
      latest && this.modelRuntimeInternal.getPhysicalModel(latest.provider, latest.model);
    return model && { model, thinkingLevel: latest?.thinkingLevel };
  }

  protected askTool(name: string, tool: agentTypes.AgentTool): agentTypes.AgentTool[] {
    const definition = this.toolDefinitions.get(name)?.definition;
    const asked = definition === undefined ? undefined : askDefinition(definition);
    if (asked === undefined) return [];
    if (asked === definition) return [tool];
    const variant = this.askVariants.get(name)?.tool;
    return variant === undefined ? [] : [variant];
  }

  protected appendCustomMessage(appMessage: messagesTypes.CustomMessage): void {
    this.sessionManager.appendCustomMessageEntry(
      appMessage.customType,
      appMessage.content,
      appMessage.display,
      appMessage.details,
    );
    this.refreshFinalizedContext();
    this.emit({ message: appMessage, type: "message_start" });
    this.emit({ message: appMessage, type: "message_end" });
  }

  protected flushPendingCustomMessages(): void {
    if (this.pendingCustomMessages.length === 0) return;

    const pending = this.pendingCustomMessages;
    this.pendingCustomMessages = [];
    for (const appMessage of pending) {
      this.appendCustomMessage(appMessage);
    }
  }

  protected addPersistedDefaultToNonEmptyScope(model: compatTypes.Model<any>): void {
    if (this.scopedModelsInternal.length === 0) return;
    if (this.scopedModelsInternal.some((scoped) => modelsAreEqual(scoped.model, model))) return;

    this.scopedModelsInternal = [...this.scopedModelsInternal, { model }];

    const enabledModels = this.settingsManager.getEnabledModels();
    if (enabledModels?.length === undefined || enabledModels?.length === 0) return;

    const modelReference = `${model.provider}/${model.id}`;
    if (enabledModels.some((pattern) => pattern.toLowerCase() === modelReference.toLowerCase()))
      return;
    this.settingsManager.setEnabledModels([...enabledModels, modelReference]);
  }

  getAvailableThinkingLevels(): agentTypes.ThinkingLevel[] {
    if (this.model === undefined) return [...THINKING_LEVEL_OPTIONS];
    return getSupportedThinkingLevels(this.model) as agentTypes.ThinkingLevel[];
  }

  protected getThinkingLevelForModelSwitch(
    targetModel?: compatTypes.Model<any>,
    explicitLevel?: agentTypes.ThinkingLevel,
  ): agentTypes.ThinkingLevel {
    if (explicitLevel !== undefined) {
      return explicitLevel;
    }
    if (targetModel !== undefined) {
      const perModel = this.settingsManager.getModelThinkingLevel(
        targetModel.provider,
        targetModel.id,
      );
      if (perModel !== undefined) {
        return perModel;
      }
    }
    return (
      this.settingsManager.getDefaultThinkingLevel() ?? this.thinkingLevel ?? DEFAULT_THINKING_LEVEL
    );
  }

  protected clampThinkingLevel(
    level: agentTypes.ThinkingLevel,
    _availableLevels: agentTypes.ThinkingLevel[],
  ): agentTypes.ThinkingLevel {
    return this.model === undefined
      ? "off"
      : (clampThinkingLevel(this.model, level) as agentTypes.ThinkingLevel);
  }

  protected indexToolPrompts(
    definitionRegistry: Map<string, agentSessionInternalTypes.ToolDefinitionEntry>,
  ): void {
    const definitions = Array.from(definitionRegistry.values(), ({ definition }) => definition);
    this.toolPromptSnippets = new Map(
      definitions.flatMap((definition) => {
        const snippet = this.normalizePromptSnippet(definition.promptSnippet);
        return snippet !== undefined && snippet !== "" ? [[definition.name, snippet] as const] : [];
      }),
    );
    this.toolPromptGuidelines = new Map(
      definitions.flatMap((definition) => {
        const guidelines = this.normalizePromptGuidelines(definition.promptGuidelines);
        return guidelines.length > 0 ? [[definition.name, guidelines] as const] : [];
      }),
    );
  }

  protected isRetryableError(message: compatTypes.AssistantMessage): boolean {
    if (
      isContextOverflow(message, (this.modelForMessage(message) ?? this.model)?.contextWindow ?? 0)
    )
      return false;
    return isRetryableAssistantError(message);
  }

  getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
    const entries = this.sessionManager.getEntries();
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
