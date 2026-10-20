import tuiModule from "@msa/tui";

import type compactionTypes from "../../core/compaction/index.types.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import messagesModule from "../../core/messages.ts";
import platformModule from "../../core/platform.ts";
import sessionManagerSupport from "../../core/session-manager-support.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer34 from "./interactive-mode-layer-34.ts";

const { createCompactionSummaryMessage, createCustomMessage } = messagesModule;
const { nowIso } = platformModule;
const { TuiAltScreen } = tuiModule;
const { sessionEntryToContextMessages } = sessionManagerSupport;
const { isCompactionCostNotice, isCustomSessionEntry, isUsageSessionEntry } =
  interactiveModeHelpers;

export default abstract class InteractiveModeLayer35 extends InteractiveModeLayer34 {
  protected navigateTreeFromExtension(
    targetId: string,
    options: Parameters<extensionsTypes.ExtensionCommandContextActions["navigateTree"]>[1],
  ) {
    return this.session
      .navigateTree(targetId, {
        customInstructions: options?.customInstructions,
        label: options?.label,
        replaceInstructions: options?.replaceInstructions,
        summarize: options?.summarize,
      })
      .then((result) => {
        if (result.cancelled) return { cancelled: true };
        this.chatContainer.clear();
        this.renderInitialMessages();
        const editorText = result.editorText ?? "";
        if (editorText !== "" && this.editor.getText().trim() === "")
          this.editor.setText(editorText);
        this.showStatus("Navigated to selected point");
        void this.flushCompactionQueue({ willRetry: false });
        return { cancelled: false };
      });
  }

  protected renderCurrentSessionState(): void {
    this.loadedResourcesContainer.clear();
    this.chatContainer.clear();
    this.pendingMessagesContainer.clear();
    this.compactionQueuedMessages = [];
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.pendingTools.clear();
    this.renderInitialMessages();
  }

  protected onCompactionEntryAppended(entry: sessionManagerTypes.CompactionEntry): void {
    const entries = this.sessionManager.buildContextEntries();
    if (entries[0]?.id !== entry.id) return;
    this.chatContainer.clear();
    const branch = this.sessionManager.getBranch();
    const compactionIndex = branch.findIndex((candidate) => candidate.id === entry.id);
    const afterCompaction = new Set(branch.slice(compactionIndex + 1).map((item) => item.id));
    const retainedEntries = entries.slice(1);
    this.renderSessionEntries(retainedEntries.filter((item) => !afterCompaction.has(item.id)));
    this.addMessageToChat(
      createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
    );
    if (entry.usage !== undefined)
      this.addCompactionCostNotice({
        kind: "compaction",
        type: "compaction_cost",
        usage: entry.usage,
      });
    this.renderSessionEntries(retainedEntries.filter((item) => afterCompaction.has(item.id)));
    for (const entryId of afterCompaction) this.entriesRenderedByBoundaryCompaction.add(entryId);
    this.footer.invalidate();
    this.ui.requestRender();
  }

  protected onEntryAppended(entry: sessionManagerTypes.SessionEntry): void {
    if (this.entriesRenderedByBoundaryCompaction.delete(entry.id)) return;
    if (entry.type === "compaction") {
      this.onCompactionEntryAppended(entry);
      return;
    }
    if (entry.type === "custom") this.addCustomEntryToChat(entry);
    else if (entry.type === "usage" && entry.kind === "cache_warm")
      this.addCacheWarmingUsage(entry);
    else if (entry.type === "custom_message" && entry.display) {
      this.addMessageToChat(
        createCustomMessage(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
          entry.timestamp,
        ),
      );
    } else return;
    this.ui.requestRender();
  }

  protected renderCompactedSession(result: compactionTypes.CompactionResult): void {
    const entries = this.sessionManager.buildContextEntries();
    if (entries[0]?.type !== "compaction")
      throw new Error("Completed compaction is missing from the session context");
    this.chatContainer.clear();
    this.renderSessionEntries(entries.slice(1));
    this.addMessageToChat(
      createCompactionSummaryMessage(result.summary, result.tokensBefore, nowIso()),
    );
    if (result.usage !== undefined)
      this.addCompactionCostNotice({
        kind: "compaction",
        type: "compaction_cost",
        usage: result.usage,
      });
    this.footer.invalidate();
  }

  protected renderSessionItems(
    items: readonly interactiveModeInternalTypes.RenderSessionItem[],
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    const { renderedPendingTools, cacheMisses } =
      this.renderSessionItemsRenderedPendingTools(options);
    for (const item of items) {
      if (isCustomSessionEntry(item)) this.addCustomEntryToChat(item);
      else if (isUsageSessionEntry(item)) this.addCacheWarmingUsage(item);
      else if (isCompactionCostNotice(item)) this.addCompactionCostNotice(item);
      else if (item.role === "assistant")
        this.replayAssistantItem(item, renderedPendingTools, cacheMisses);
      else if (item.role === "toolResult") {
        const component = renderedPendingTools.get(item.toolCallId);
        if (component !== undefined) {
          component.updateResult(item);
          renderedPendingTools.delete(item.toolCallId);
        }
      } else this.addMessageToChat(item, options);
    }
    for (const [toolCallId, component] of renderedPendingTools)
      this.pendingTools.set(toolCallId, component);
    this.ui.requestRender();
  }

  protected renderSessionEntries(
    entries: sessionManagerTypes.SessionEntry[],
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    if (this.renderer instanceof TuiAltScreen) this.renderer.resetTextSelection();
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
    const entries = this.sessionManager.buildContextEntries();
    this.renderSessionEntries(entries, {
      populateHistory: true,
      updateFooter: true,
    });
    this.renderProjectTrustWarningIfNeeded();

    const allEntries = this.sessionManager.getEntries();
    const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
    if (compactionCount > 0) {
      const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.showStatus(`Session compacted ${times}`);
    }
  }

  protected rebuildChatFromMessages(): void {
    this.chatContainer.clear();
    this.renderSessionEntries(this.sessionManager.buildContextEntries());
  }
}
