import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import AgentSessionLayer10 from "./agent-session-layer-10.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import compactionModule from "./compaction/index.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import messagesModule from "./messages.ts";
import platform from "./platform.ts";
import sessionManagerSupport from "./session-manager-support.ts";
import SessionManager from "./session-manager.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const {
  calculateContextTokens,
  estimateContextTokens,
  estimateProjectedContextTokens,
  shouldCompact,
} = compactionModule;
const { getLatestCompactionEntry } = sessionManagerSupport;
const { convertToLlm } = messagesModule;
const { isContextOverflow, isRecoverableLength } = compat;
const { toEpochMs } = platform;

export default abstract class AgentSessionLayer11 extends AgentSessionLayer10 {
  protected exceedsCompactionThreshold(
    model: compatTypes.Model<any>,
    projection: sessionManagerTypes.SessionProjection,
  ): boolean {
    if (model.contextWindow <= 0) return false;
    return shouldCompact(
      estimateProjectedContextTokens(projection, this.sessionManager.getBranch()).tokens,
      model.contextWindow,
      this.settingsManager.getCompactionSettings(this.model),
    );
  }

  protected applyBoundaryDrafts(
    manager: sessionManagerTypes.SessionManager,
    drafts: extensionsTypes.SessionBoundaryDraft[],
  ): sessionManagerTypes.SessionEntry[] {
    const appended: sessionManagerTypes.SessionEntry[] = [];
    for (const draft of drafts) {
      let entryId: string;
      switch (draft.type) {
        case "custom":
          entryId = manager.appendCustomEntry(draft.customType, draft.data);
          break;
        case "custom_message":
          entryId = manager.appendCustomMessageEntry(
            draft.customType,
            draft.content,
            draft.display,
            draft.details,
          );
          break;
        case "context_edit":
          entryId = manager.appendContextEdit(draft.targetId, draft.replacement);
          break;
        case "compaction": {
          const tokensBefore = estimateProjectedContextTokens(
            manager.buildSessionProjection(),
            manager.getBranch(),
          ).tokens;
          entryId = manager.appendCompaction(
            draft.summary,
            draft.firstKeptEntryId,
            tokensBefore,
            draft.details,
            true,
            draft.usage,
          );
          break;
        }
      }
      const entry = manager.getEntry(entryId);
      if (entry !== undefined) appended.push(entry);
    }
    return appended;
  }

  protected createBoundaryPreviewManager(
    drafts: extensionsTypes.SessionBoundaryDraft[],
  ): sessionManagerTypes.SessionManager {
    const header = this.sessionManager.getHeader();
    if (header === null) throw new Error("Session header is missing");
    const manager = SessionManager.inMemory(this.cwd, undefined, [
      header,
      ...this.sessionManager.getBranch(),
    ]);
    this.applyBoundaryDrafts(manager, drafts);
    return manager;
  }

  protected buildBoundaryContext(
    drafts: extensionsTypes.SessionBoundaryDraft[],
    boundary: "turn_end" | "agent_before_settle",
  ): extensionsTypes.BoundaryContextPreview {
    const projection = this.createBoundaryPreviewManager(drafts).buildSessionProjection();
    const pendingMessages = this.getPendingBoundaryMessages();
    const llmMessages = convertToLlm(projection.messages);
    const finalRole = llmMessages[llmMessages.length - 1]?.role;
    const hasNonSystemContext = llmMessages.some((message) => message.role !== "system");
    const contextCanContinue = hasNonSystemContext && finalRole !== "assistant";
    const pendingCustomContext = this.pendingCustomMessages.length > 0;
    return {
      canContinue:
        contextCanContinue ||
        pendingCustomContext ||
        (boundary === "turn_end"
          ? this.agent.hasQueuedMessages()
          : finalRole === "assistant" && this.agent.hasQueuedMessages()),
      contextEntries: projection.entries,
      contextMessages: projection.messages,
      llmMessages,
      pendingMessages,
    };
  }

  protected commitBoundaryDrafts(drafts: extensionsTypes.SessionBoundaryDraft[]): void {
    const appended = this.applyBoundaryDrafts(this.sessionManager, drafts);
    this.refreshFinalizedContext();
    for (const entry of appended) this.emit({ entry, type: "entry_appended" });
  }

  protected totalSessionTokens(): number {
    const entryCount = this.sessionManager.getEntryCount();
    if (this.totalTokensCache?.entryCount !== entryCount) {
      this.totalTokensCache = { entryCount, total: this.getSessionStats().tokens.total };
    }
    return this.totalTokensCache.total;
  }

  protected assessOverflow(
    assistantMessage: compatTypes.AssistantMessage,
    projection: sessionManagerTypes.SessionProjection,
    branch: sessionManagerTypes.SessionEntry[],
  ) {
    const messageModel = this.modelForMessage(assistantMessage);
    const contextWindow = (messageModel ?? this.model)?.contextWindow ?? 0;
    const assistantEntryId = this.findPersistedMessageEntryId(assistantMessage);
    const assistantIsProjected =
      assistantEntryId === undefined ||
      projection.entries.some(
        (entry) =>
          entry.sourceEntry.id === assistantEntryId &&
          entry.messages.some((message) => message.role === "assistant"),
      );
    const assistantIndex =
      assistantEntryId !== undefined && assistantEntryId !== ""
        ? branch.findIndex((entry) => entry.id === assistantEntryId)
        : -1;
    const afterAssistant = assistantIndex >= 0 ? branch.slice(assistantIndex + 1) : [];
    const latestAssistantEdit = afterAssistant
      .filter(
        (entry): entry is sessionManagerTypes.ContextEditEntry =>
          entry.type === "context_edit" && entry.targetId === assistantEntryId,
      )
      .at(-1);
    const retainedForExplicitRecovery =
      assistantEntryId === undefined ||
      (!afterAssistant.some((entry) => entry.type === "compaction") &&
        latestAssistantEdit?.replacement !== null);
    const usageMatchesProjection =
      assistantIsProjected && !afterAssistant.some((entry) => entry.type === "context_edit");
    const explicitOverflow =
      assistantMessage.stopReason === "error" && isContextOverflow(assistantMessage);
    const contextOverflow =
      messageModel !== undefined &&
      ((explicitOverflow && retainedForExplicitRecovery) ||
        (usageMatchesProjection && isContextOverflow(assistantMessage, contextWindow)));
    const recoverableLength =
      messageModel !== undefined &&
      assistantIsProjected &&
      isRecoverableLength(assistantMessage, messageModel.maxTokens);
    return { contextOverflow, contextWindow, recoverableLength };
  }

  protected measureContextTokens(
    assistantMessage: compatTypes.AssistantMessage,
    projection: sessionManagerTypes.SessionProjection,
    branch: sessionManagerTypes.SessionEntry[],
    compactionEntry: sessionManagerTypes.CompactionEntry | null,
  ): number | undefined {
    if (projection.entries.some((entry) => entry.sourceEntry.type === "context_edit"))
      return estimateProjectedContextTokens(projection, branch).tokens;
    const directContextTokens =
      assistantMessage.usage === undefined ? 0 : calculateContextTokens(assistantMessage.usage);
    if (assistantMessage.stopReason !== "error" && directContextTokens !== 0)
      return directContextTokens;
    const messages = this.agent.state.messages;
    const estimate = estimateContextTokens(messages);
    if (estimate.lastUsageIndex !== null && compactionEntry !== null) {
      const usageMsg = messages[estimate.lastUsageIndex];
      if (
        usageMsg?.role === "assistant" &&
        (usageMsg as compatTypes.AssistantMessage).timestamp <= toEpochMs(compactionEntry.timestamp)
      )
        return undefined;
    }
    return estimate.tokens;
  }

  getSessionStats(): agentSessionTypes.SessionStats {
    const { counts, usageTotals } = this.countSessionEntries();
    return {
      ...counts,
      contextUsage: this.getContextUsage(),
      cost: usageTotals.cost,
      sessionFile: this.sessionFile,
      sessionId: this.sessionId,
      tokens: {
        cacheRead: usageTotals.cacheRead,
        cacheWrite: usageTotals.cacheWrite,
        input: usageTotals.input,
        output: usageTotals.output,
        total:
          usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite,
      },
    };
  }

  getContextUsage(): extensionsTypes.ContextUsage | undefined {
    const model = this.limitsModel();
    if (model === undefined) return undefined;

    const contextWindow = model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;

    const projection = this.sessionManager.buildSessionProjection();
    const branch = this.sessionManager.getBranch();
    const latestCompaction = getLatestCompactionEntry(branch);

    if (latestCompaction !== null) {
      const projectedAssistants = new Set(
        projection.entries.flatMap((entry) =>
          entry.messages.some(
            (message) =>
              message.role === "assistant" &&
              message.stopReason !== "aborted" &&
              message.stopReason !== "error" &&
              calculateContextTokens(message.usage) > 0,
          )
            ? [entry.sourceEntry.id]
            : [],
        ),
      );
      const compactionIndex = branch.findIndex((entry) => entry.id === latestCompaction.id);
      const hasPostCompactionUsage = branch
        .slice(compactionIndex + 1)
        .some((entry) => projectedAssistants.has(entry.id));
      if (!hasPostCompactionUsage) return { contextWindow, percent: null, tokens: null };
    }

    const estimate = estimateProjectedContextTokens(projection, branch);
    const percent = (estimate.tokens / contextWindow) * 100;

    return {
      contextWindow,
      percent,
      tokens: estimate.tokens,
    };
  }
}
