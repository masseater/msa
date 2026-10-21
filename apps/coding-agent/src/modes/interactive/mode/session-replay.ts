import type compatTypes from "@msa/ai/compat.types";

import cacheStats from "../../../core/cache-stats.ts";
import type cacheStatsTypes from "../../../core/cache-stats.types.ts";
import type toolExecutionTypes from "../components/tool-execution.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { collectCacheMisses } = cacheStats;

export default class SessionReplay {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  prepareSessionItemsRender(options: { updateFooter?: boolean; populateHistory?: boolean }): {
    renderedPendingTools: Map<string, toolExecutionTypes.ToolExecutionComponent>;
    cacheMisses: Map<compatTypes.AssistantMessage, cacheStatsTypes.CacheMiss>;
  } {
    this.mode.view.toolExecutions.pendingTools.clear();
    const renderedPendingTools = new Map<string, toolExecutionTypes.ToolExecutionComponent>();
    const cacheMisses = this.mode.settingsManager.display.getShowCacheMissNotices()
      ? collectCacheMisses(
          this.mode.sessionManager.getEntries(),
          this.mode.session.models.selection.modelRuntime,
        )
      : new Map<compatTypes.AssistantMessage, cacheStatsTypes.CacheMiss>();

    if (options.updateFooter === true) {
      this.mode.footer.invalidate();
      this.mode.input.keys.updateEditorBorderColor();
    }
    return { cacheMisses, renderedPendingTools };
  }

  replayAssistantItem(
    message: compatTypes.AssistantMessage,
    renderedPendingTools: Map<string, toolExecutionTypes.ToolExecutionComponent>,
    cacheMisses: Map<compatTypes.AssistantMessage, cacheStatsTypes.CacheMiss>,
  ): void {
    this.mode.view.messages.addMessageToChat(message);
    const failed = message.stopReason === "aborted" || message.stopReason === "error";
    for (const content of message.content) {
      if (content.type !== "toolCall") continue;
      const component = this.mode.view.toolExecutions.buildToolComponent(
        content.name,
        content.id,
        content.arguments,
      );
      if (!failed) {
        renderedPendingTools.set(content.id, component);
        continue;
      }
      const retryAttempt = this.mode.session.run.retry.retryAttempt;
      const abortedText =
        retryAttempt > 0
          ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
          : "Operation aborted";
      const errorText = message.errorMessage ?? "";
      const text =
        message.stopReason === "aborted" ? abortedText : errorText === "" ? "Error" : errorText;
      component.updateResult({ content: [{ text, type: "text" }], isError: true });
    }
    if (failed) return;
    const miss = cacheMisses.get(message);
    if (miss !== undefined) this.mode.display.notices.cache.addCacheMissNotice(miss);
  }
}
