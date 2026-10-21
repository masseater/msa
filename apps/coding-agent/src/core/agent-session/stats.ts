import type compatTypes from "@msa/ai/compat.types";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import compactionModule from "../compaction/index.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import platform from "../platform/index.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionContext from "../session-manager/session-context.ts";
import usageTotalsModule from "../usage-totals.ts";

const { toEpochMs } = platform;
const { addUsageToTotals, createUsageTotals } = usageTotalsModule;
const { calculateContextTokens, estimateContextTokens, estimateProjectedContextTokens } =
  compactionModule;
const { getLatestCompactionEntry } = sessionContext;

export default class SessionStats {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private totalTokensCache: { entryCount: number; total: number } | undefined;

  private countSessionEntries() {
    const counts = {
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      userMessages: 0,
    };
    const usageTotals = createUsageTotals();
    for (const entry of this.session.sessionManager.getEntries()) {
      if (entry.type === "usage") addUsageToTotals(usageTotals, entry.usage);
      else if (
        (entry.type === "branch_summary" || entry.type === "compaction") &&
        entry.usage !== undefined
      )
        addUsageToTotals(usageTotals, entry.usage);
      if (entry.type !== "message") continue;
      counts.totalMessages++;
      const message = entry.message;
      if (message.role === "user") counts.userMessages++;
      else if (message.role === "toolResult") {
        counts.toolResults++;
        if (message.usage !== undefined) addUsageToTotals(usageTotals, message.usage);
      } else if (message.role === "assistant") {
        counts.assistantMessages++;
        const assistantMsg = message as compatTypes.AssistantMessage;
        if (Array.isArray(assistantMsg.content))
          counts.toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
        addUsageToTotals(usageTotals, assistantMsg.usage);
      }
    }
    return { counts, usageTotals };
  }

  totalSessionTokens(): number {
    const entryCount = this.session.sessionManager.getEntryCount();
    if (this.totalTokensCache?.entryCount !== entryCount) {
      this.totalTokensCache = { entryCount, total: this.getSessionStats().tokens.total };
    }
    return this.totalTokensCache.total;
  }

  measureContextTokens(
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
    const messages = this.session.agent.state.messages;
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
      sessionFile: this.session.sessionFile,
      sessionId: this.session.sessionId,
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
    const model = this.session.models.selection.limitsModel();
    if (model === undefined) return undefined;

    const contextWindow = model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;

    const projection = this.session.sessionManager.buildSessionProjection();
    const branch = this.session.sessionManager.getBranch();
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
