import tuiModule from "@msa/tui";

import type compactionTypes from "../../../core/compaction/index.types.ts";
import messagesModule from "../../../core/messages.ts";
import platformModule from "../../../core/platform.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import sessionContext from "../../../core/session-manager/session-context.ts";
import interactiveModeHelpers from "../interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "../interactive-mode-internal.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { TuiAltScreen } = tuiModule;
const { isCompactionCostNotice, isCustomSessionEntry, isUsageSessionEntry } =
  interactiveModeHelpers;
const { nowIso } = platformModule;
const { createCompactionSummaryMessage, createCustomMessage } = messagesModule;
const { sessionEntryToContextMessages } = sessionContext;

export default class SessionHistoryView {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private readonly entriesRenderedByBoundaryCompaction = new Set<string>();

  renderCurrentSessionState(): void {
    this.mode.layout.loadedResourcesContainer.clear();
    this.mode.layout.chatContainer.clear();
    this.mode.layout.pendingMessagesContainer.clear();
    this.mode.input.queue.compactionQueuedMessages = [];
    this.mode.view.streaming.streamingComponent = undefined;
    this.mode.view.streaming.streamingMessage = undefined;
    this.mode.view.toolExecutions.pendingTools.clear();
    this.renderInitialMessages();
  }

  private onCompactionEntryAppended(entry: sessionManagerTypes.CompactionEntry): void {
    const entries = this.mode.sessionManager.buildContextEntries();
    if (entries[0]?.id !== entry.id) return;
    this.mode.layout.chatContainer.clear();
    const branch = this.mode.sessionManager.getBranch();
    const compactionIndex = branch.findIndex((candidate) => candidate.id === entry.id);
    const afterCompaction = new Set(branch.slice(compactionIndex + 1).map((item) => item.id));
    const retainedEntries = entries.slice(1);
    this.renderSessionEntries(retainedEntries.filter((item) => !afterCompaction.has(item.id)));
    this.mode.view.messages.addMessageToChat(
      createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
    );
    if (entry.usage !== undefined)
      this.mode.display.notices.usage.addCompactionCostNotice({
        kind: "compaction",
        type: "compaction_cost",
        usage: entry.usage,
      });
    this.renderSessionEntries(retainedEntries.filter((item) => afterCompaction.has(item.id)));
    for (const entryId of afterCompaction) this.entriesRenderedByBoundaryCompaction.add(entryId);
    this.mode.footer.invalidate();
    this.mode.ui.requestRender();
  }

  onEntryAppended(entry: sessionManagerTypes.SessionEntry): void {
    if (this.entriesRenderedByBoundaryCompaction.delete(entry.id)) return;
    if (entry.type === "compaction") {
      this.onCompactionEntryAppended(entry);
      return;
    }
    if (entry.type === "custom") this.mode.view.entries.addCustomEntryToChat(entry);
    else if (entry.type === "usage" && entry.kind === "cache_warm")
      this.mode.display.notices.cache.addCacheWarmingUsage(entry);
    else if (entry.type === "custom_message" && entry.display) {
      this.mode.view.messages.addMessageToChat(
        createCustomMessage(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
          entry.timestamp,
        ),
      );
    } else return;
    this.mode.ui.requestRender();
  }

  renderCompactedSession(result: compactionTypes.CompactionResult): void {
    const entries = this.mode.sessionManager.buildContextEntries();
    if (entries[0]?.type !== "compaction")
      throw new Error("Completed compaction is missing from the session context");
    this.mode.layout.chatContainer.clear();
    this.renderSessionEntries(entries.slice(1));
    this.mode.view.messages.addMessageToChat(
      createCompactionSummaryMessage(result.summary, result.tokensBefore, nowIso()),
    );
    if (result.usage !== undefined)
      this.mode.display.notices.usage.addCompactionCostNotice({
        kind: "compaction",
        type: "compaction_cost",
        usage: result.usage,
      });
    this.mode.footer.invalidate();
  }

  private renderSessionItems(
    items: readonly interactiveModeInternalTypes.RenderSessionItem[],
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    const { renderedPendingTools, cacheMisses } =
      this.mode.view.replay.prepareSessionItemsRender(options);
    for (const item of items) {
      if (isCustomSessionEntry(item)) this.mode.view.entries.addCustomEntryToChat(item);
      else if (isUsageSessionEntry(item))
        this.mode.display.notices.cache.addCacheWarmingUsage(item);
      else if (isCompactionCostNotice(item))
        this.mode.display.notices.usage.addCompactionCostNotice(item);
      else if (item.role === "assistant")
        this.mode.view.replay.replayAssistantItem(item, renderedPendingTools, cacheMisses);
      else if (item.role === "toolResult") {
        const component = renderedPendingTools.get(item.toolCallId);
        if (component !== undefined) {
          component.updateResult(item);
          renderedPendingTools.delete(item.toolCallId);
        }
      } else this.mode.view.messages.addMessageToChat(item, options);
    }
    for (const [toolCallId, component] of renderedPendingTools)
      this.mode.view.toolExecutions.pendingTools.set(toolCallId, component);
    this.mode.ui.requestRender();
  }

  renderSessionEntries(
    entries: sessionManagerTypes.SessionEntry[],
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    if (this.mode.lifecycle.screen.renderer instanceof TuiAltScreen)
      this.mode.lifecycle.screen.renderer.resetTextSelection();
    const items = entries.flatMap((entry): interactiveModeInternalTypes.RenderSessionItem[] => {
      if (entry.type === "custom" || (entry.type === "usage" && entry.kind === "cache_warm")) {
        return [entry];
      }
      const messages = sessionEntryToContextMessages(entry);
      if (
        (entry.type === "compaction" || entry.type === "branch_summary") &&
        entry.usage !== undefined &&
        messages.length > 0
      ) {
        return [...messages, { kind: entry.type, type: "compaction_cost", usage: entry.usage }];
      }
      return messages;
    });
    this.renderSessionItems(items, options);
  }

  renderInitialMessages(): void {
    const entries = this.mode.sessionManager.buildContextEntries();
    this.renderSessionEntries(entries, {
      populateHistory: true,
      updateFooter: true,
    });
    this.mode.display.notices.warnings.renderProjectTrustWarningIfNeeded();

    const allEntries = this.mode.sessionManager.getEntries();
    const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
    if (compactionCount > 0) {
      const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.mode.display.status.showStatus(`Session compacted ${times}`);
    }
  }

  rebuildChatFromMessages(): void {
    this.mode.layout.chatContainer.clear();
    this.renderSessionEntries(this.mode.sessionManager.buildContextEntries());
  }
}
