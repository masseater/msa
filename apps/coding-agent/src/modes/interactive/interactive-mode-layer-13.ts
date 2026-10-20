import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import keybindingHints from "./components/keybinding-hints.ts";
import statusIndicators from "./components/status-indicators.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import InteractiveModeLayer12 from "./interactive-mode-layer-12.ts";
import loginFlowSupport from "./login-flow-support.ts";
import modelSearch from "./model-search.ts";
import themeModule from "./theme/theme.ts";

const { getModelSearchText } = modelSearch;
const {
  formatLoginProviderCompletionDescription,
  getLoginProviderCompletionOptions,
  getLoginProviderSearchText,
} = loginFlowSupport;
const { theme } = themeModule;
const { WorkingStatusIndicator } = statusIndicators;
const { Spacer, TruncatedText } = tuiModule;
const { keyDisplayText } = keybindingHints;
const { createFuzzyAutocompleteItems, isEmbeddedStatus } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer13 extends InteractiveModeLayer12 {
  protected modelArgumentCompletions(prefix: string): tuiTypes.AutocompleteItem[] | null {
    const models =
      this.session.scopedModels.length > 0
        ? this.session.scopedModels.map((scoped) => scoped.model)
        : this.session.modelRuntime.getAvailableSnapshot();
    if (models.length === 0) return null;
    const items = models.map((m) => ({
      id: m.id,
      label: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
    }));
    return createFuzzyAutocompleteItems(items, prefix, getModelSearchText, (item) => ({
      description: item.provider,
      label: item.id,
      value: item.label,
    }));
  }

  protected createBaseAutocompleteProviderPart2(
    thinkingCommand: tuiTypes.SlashCommand | undefined,
    slashCommands: tuiTypes.SlashCommand[],
  ): void {
    if (thinkingCommand !== undefined) {
      thinkingCommand.getArgumentCompletions = (
        prefix: string,
      ): tuiTypes.AutocompleteItem[] | null =>
        createFuzzyAutocompleteItems(
          this.session.getAvailableThinkingLevels(),
          prefix,
          (level) => level,
          (level) => ({
            label: level,
            value: level,
          }),
        );
    }

    const loginCommand = slashCommands.find((command) => command.name === "login");
    if (loginCommand !== undefined) {
      loginCommand.getArgumentCompletions = (
        prefix: string,
      ): tuiTypes.AutocompleteItem[] | null => {
        const providers = getLoginProviderCompletionOptions(this.loginFlow.getProviderOptions());
        const items = [
          ...providers.map((provider) => ({
            item: {
              description: formatLoginProviderCompletionDescription(provider),
              label: provider.id,
              value: provider.id,
            },
            searchText: getLoginProviderSearchText(provider),
          })),
          ...this.session.getExternalServices().map((service) => ({
            item: { description: service.purpose, label: service.id, value: service.id },
            searchText: `${service.id} ${service.name} ${service.purpose}`,
          })),
        ];
        return createFuzzyAutocompleteItems(
          items,
          prefix,
          (entry) => entry.searchText,
          (entry) => entry.item,
        );
      };
    }
  }

  protected showWorkingStatusIndicator(): void {
    const colorFn = isEmbeddedStatus(this.editor)
      ? (text: string) =>
          (
            this.editor.borderColor ??
            theme.getThinkingBorderColor(this.session.thinkingLevel || "off")
          )(text)
      : undefined;
    this.showStatusIndicator(
      new WorkingStatusIndicator(
        this.ui,
        this.workingMessage ?? this.defaultWorkingMessage,
        this.workingIndicatorOptions,
        colorFn,
      ),
    );
  }

  protected setWorkingVisible(visible: boolean): void {
    this.workingVisible = visible;
    if (!visible) {
      this.clearStatusIndicator("working");
      this.ui.requestRender();
      return;
    }
    if (this.session.isStreaming && this.activeStatusIndicator?.kind !== "working") {
      this.showWorkingStatusIndicator();
    }
    this.ui.requestRender();
  }

  protected onTurnStart(): void {
    if (this.settingsManager.getShowTerminalProgress()) this.ui.terminal.setProgress(true);
    if (!this.workingVisible) this.clearStatusIndicator();
    else if (this.activeStatusIndicator?.kind !== "working") this.showWorkingStatusIndicator();
    this.ui.requestRender();
  }

  protected handleViewRefreshEvent(event: agentSessionTypes.AgentSessionEvent): void {
    switch (event.type) {
      case "queue_update":
        this.updatePendingMessagesDisplay();
        break;
      case "session_info_changed":
        this.updateTerminalTitle();
        this.footer.invalidate();
        break;
      case "thinking_level_changed":
        this.footer.invalidate();
        this.updateEditorBorderColor();
        return;
      case "summarization_retry_finished":
        this.clearStatusIndicator("retry");
        break;
      case "goal_changed":
        this.updateGoalTicker();
        break;
      case "orchestrator_changed":
      case "pr_watch_changed":
        this.footer.invalidate();
        break;
      default:
        return;
    }
    this.ui.requestRender();
  }

  protected handleDequeue(): void {
    const restored = this.restoreQueuedMessagesToEditor();
    if (restored === 0) {
      this.showStatus("No queued messages to restore");
    } else {
      this.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
    }
  }

  protected updatePendingMessagesDisplay(): void {
    this.pendingMessagesContainer.clear();
    const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
    if (steeringMessages.length > 0 || followUpMessages.length > 0) {
      this.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of steeringMessages) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of followUpMessages) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = keyDisplayText("app.message.dequeue");
      const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
      this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  protected restoreQueuedMessagesToEditor(options?: {
    abort?: boolean;
    currentText?: string;
  }): number {
    const { steering, followUp } = this.clearAllQueues();
    const allQueued = [...steering, ...followUp];
    if (allQueued.length === 0) {
      this.updatePendingMessagesDisplay();
      if (options?.abort === true) {
        void this.session.abort();
      }
      return 0;
    }
    const queuedText = allQueued.join("\n\n");
    const currentText = options?.currentText ?? this.editor.getText();
    const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
    this.editor.setText(combinedText);
    this.updatePendingMessagesDisplay();
    if (options?.abort === true) {
      void this.session.abort();
    }
    return allQueued.length;
  }

  protected queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
    this.compactionQueuedMessages.push({ mode, text });
    this.editor.addToHistory?.(text);
    this.editor.setText("");
    this.updatePendingMessagesDisplay();
    this.showStatus("Queued message for after compaction");
  }
}
