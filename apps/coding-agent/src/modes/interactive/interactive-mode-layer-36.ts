import tuiModule from "@msa/tui";
import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import defaults from "../../core/defaults.ts";
import SettingsSelectorComponent from "./components/settings-selector.ts";
import type settingsSelectorTypes from "./components/settings-selector.types.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer35 from "./interactive-mode-layer-35.ts";
import themeModule from "./theme/theme.ts";

const { Spacer } = tuiModule;
const { theme } = themeModule;
const { awaitingWith, performed } = awaitingModule;
const { DEFAULT_THINKING_LEVEL } = defaults;

export default abstract class InteractiveModeLayer36 extends InteractiveModeLayer35 {
  protected onCompactionEnd(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "compaction_end" }>,
  ): void {
    this.handleEventPart4();
    if (event.aborted) {
      if (event.reason === "manual") this.showError("Compaction cancelled");
      else this.showStatus("Auto-compaction cancelled");
    } else if (event.result !== undefined) {
      this.renderCompactedSession(event.result);
    } else if (event.errorMessage !== undefined && event.errorMessage !== "") {
      const errorMessage = event.errorMessage;
      if (event.reason === "manual") this.showError(errorMessage);
      else {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new ThemedText(() => theme.fg("error", errorMessage), 1, 0));
      }
    }
    void this.flushCompactionQueue({ willRetry: event.willRetry });
    this.ui.requestRender();
  }

  protected handleSessionEvent(event: agentSessionTypes.AgentSessionEvent): Effect.Effect<void> {
    return awaitingWith(function* () {
      switch (event.type) {
        case "entry_appended":
          return this.onEntryAppended(event.entry);
        case "agent_settled":
          return yield* performed(this.checkShutdownRequested());
        case "compaction_start":
          return this.onCompactionStart(event.reason);
        case "compaction_end":
          return this.onCompactionEnd(event);
        case "auto_retry_start":
          this.retryEscapeHandler = this.defaultEditor.onEscape;
          this.defaultEditor.onEscape = () => {
            this.session.run.retry.abortRetry();
          };
          return this.showRetryStatus(event.attempt, event.maxAttempts, event.delayMs);
        case "auto_retry_end":
          return this.onAutoRetryEnd(event);
        case "summarization_retry_scheduled":
          this.showError(event.errorMessage);
          return this.showRetryStatus(event.attempt, event.maxAttempts, event.delayMs);
        case "summarization_retry_attempt_start":
          return this.onSummarizationAttemptStart(event);
        case "goal_status":
          return this.onGoalStatus(event.goal);
        case "memory_status":
          return this.addMutedLines(() =>
            event.text
              .split("\n")
              .map((line) => theme.fg("muted", line))
              .join("\n"),
          );
        default:
          return this.handleViewRefreshEvent(event);
      }
    }, this);
  }

  protected settingsCallbacks4() {
    return {
      onModelThinkingLevelRemove: (provider, modelId) => {
        this.settingsManager.removeModelThinkingLevel(provider, modelId);
        const current = this.session.model;
        if (current !== undefined && current.provider === provider && current.id === modelId) {
          const globalDefault =
            this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
          this.session.models.thinking.setThinkingLevel(globalDefault);
          this.footer.invalidate();
          this.updateEditorBorderColor();
        }
      },
      onOutputPadChange: (padding) => {
        this.settingsManager.setOutputPad(padding);
        this.outputPad = padding;
        for (const children of [this.chatComponents(), this.pendingMessagesContainer.children]) {
          for (const child of children) {
            if ("setOutputPad" in child && typeof child.setOutputPad === "function") {
              child.setOutputPad(padding);
            }
          }
        }
        this.ui.requestRender();
      },
      onQuietStartupChange: (quiet) => {
        this.settingsManager.setQuietStartup(quiet);
      },
      onShowCacheMissNoticesChange: (shown) => {
        this.settingsManager.setShowCacheMissNotices(shown);
        this.rebuildChatFromMessages();
      },
      onShowHardwareCursorChange: (enabled) => {
        this.settingsManager.setShowHardwareCursor(enabled);
        this.ui.setShowHardwareCursor(enabled);
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  protected showSettingsSelector(): void {
    this.editorSlot.showSelector((done) => {
      let selector: settingsSelectorTypes.SettingsSelectorComponent | undefined;
      const callbacks: settingsSelectorTypes.SettingsCallbacks = {
        ...this.settingsCallbacks1(done),
        ...this.settingsCallbacks2(),
        ...this.settingsCallbacks3(),
        ...this.settingsCallbacks4(),
        ...this.settingsCallbacks5(() => selector),
      };
      selector = new SettingsSelectorComponent(
        { ...this.settingsConfigDisplay(), ...this.settingsConfigBehavior() },
        callbacks,
      );
      return { component: selector, focus: selector.getSettingsList() };
    });
  }
}
