import tuiModule from "@msa/tui";

import goalModule from "../../../core/goal.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import CustomEntryComponent from "../components/custom-entry.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer } = tuiModule;
const { describeGoalEntry } = goalModule;

export default class CustomEntriesView {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  addCustomEntryToChat(entry: Extract<sessionManagerTypes.SessionEntry, { type: "custom" }>): void {
    const goalLine = describeGoalEntry(entry);
    if (goalLine !== undefined) {
      this.mode.layout.chatContainer.addChild(new Spacer(1));
      this.mode.layout.chatContainer.addChild(
        new ThemedText(
          () => theme.fg(goalLine.tone, goalLine.text),
          this.mode.display.thinking.outputPad,
          0,
        ),
      );
      return;
    }
    const renderer = this.mode.session.extensions.binding.extensionRunner.getEntryRenderer(
      entry.customType,
    );
    if (renderer === undefined) {
      return;
    }
    const component = new CustomEntryComponent(
      entry,
      renderer,
      this.mode.display.thinking.outputPad,
    );
    component.setExpanded(this.mode.display.resources.toolOutputExpanded);
    if (!component.hasContent()) {
      return;
    }

    if (this.mode.view.streaming.streamingComponent !== undefined) {
      const streamingIndex = this.mode.layout.chatContainer.children.indexOf(
        this.mode.view.streaming.streamingComponent,
      );
      if (streamingIndex >= 0) {
        this.mode.layout.chatContainer.children.splice(streamingIndex, 0, component);
        return;
      }
    }

    this.mode.layout.chatContainer.addChild(component);
  }
}
