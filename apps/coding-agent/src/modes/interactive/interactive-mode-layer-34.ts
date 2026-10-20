import tuiModule from "@msa/tui";

import goalModule from "../../core/goal.ts";
import platformModule from "../../core/platform.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
import chatViewport from "./chat-viewport.ts";
import CustomEntryComponent from "./components/custom-entry.ts";
import keybindingHints from "./components/keybinding-hints.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer33 from "./interactive-mode-layer-33.ts";
import themeModule from "./theme/theme.ts";

const { theme } = themeModule;
const { formatKeyText } = keybindingHints;
const { writeLog } = platformModule;
const { createChatViewport } = chatViewport;
const { describeGoalEntry } = goalModule;
const { Spacer } = tuiModule;

export default abstract class InteractiveModeLayer34 extends InteractiveModeLayer33 {
  protected initStartupVisibility(): {
    header: boolean;
    details: boolean;
  } {
    this.registerSignalHandlers();

    this.changelogMarkdown = this.getChangelogForDisplay();

    const startupVisibility = this.getStartupVisibility();
    if (this.session.models.selection.scopedModels.length > 0 && startupVisibility.details) {
      const modelList = this.session.models.selection.scopedModels
        .map((sm) => {
          const thinkingStr = sm.thinkingLevel === undefined ? "" : `:${sm.thinkingLevel}`;
          return `${sm.model.id}${thinkingStr}`;
        })
        .join(", ");
      const cycleKeys = this.keybindings.getKeys("app.model.cycleForward");
      const cycleHint =
        cycleKeys.length > 0
          ? theme.fg(
              "muted",
              ` (${formatKeyText(cycleKeys.join("/"), { capitalize: true })} to cycle)`,
            )
          : "";
      writeLog(theme.fg("dim", `Model scope: ${modelList}${cycleHint}`));
    }

    const viewport = createChatViewport({
      document: this.documentContainer,
      editor: this.editorContainer,
      footer: this.footerContainer,
      pendingMessages: this.pendingMessagesContainer,
      scrollbar: this.settingsManager.getFullscreenScrollbar(),
      scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
      scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
      status: this.statusContainer,
      widgetsAbove: this.extensionWidgets.above,
      widgetsBelow: this.extensionWidgets.below,
    });
    this.transcriptScrollView = viewport.transcript;
    this.fullscreenLayoutRoot = this.orchestratorPane.layout(viewport.root);
    return startupVisibility;
  }

  protected addCustomEntryToChat(
    entry: Extract<sessionManagerTypes.SessionEntry, { type: "custom" }>,
  ): void {
    const goalLine = describeGoalEntry(entry);
    if (goalLine !== undefined) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new ThemedText(() => theme.fg(goalLine.tone, goalLine.text), this.outputPad, 0),
      );
      return;
    }
    const renderer = this.session.extensions.binding.extensionRunner.getEntryRenderer(
      entry.customType,
    );
    if (renderer === undefined) {
      return;
    }
    const component = new CustomEntryComponent(entry, renderer, this.outputPad);
    component.setExpanded(this.toolOutputExpanded);
    if (!component.hasContent()) {
      return;
    }

    if (this.streamingComponent !== undefined) {
      const streamingIndex = this.chatContainer.children.indexOf(this.streamingComponent);
      if (streamingIndex >= 0) {
        this.chatContainer.children.splice(streamingIndex, 0, component);
        return;
      }
    }

    this.chatContainer.addChild(component);
  }
}
