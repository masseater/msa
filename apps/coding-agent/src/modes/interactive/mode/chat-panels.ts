import tuiModule from "@msa/tui";

import goalModule from "../../../core/goal.ts";
import type goalTypes from "../../../core/goal.types.ts";
import platform from "../../../core/platform/index.ts";
import DynamicBorder from "../components/dynamic-border.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer, Markdown } = tuiModule;
const { nowMs } = platform;
const { describeGoalStatus } = goalModule;

export default class ChatPanels {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  addMutedLines(render: () => string): void {
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(render, this.mode.display.thinking.outputPad, 0),
    );
    this.mode.ui.requestRender();
  }

  addMarkdownPanel(title: string, markdown: string): void {
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(new DynamicBorder());
    this.mode.layout.chatContainer.addChild(
      new ThemedText(() => theme.bold(theme.fg("accent", title)), 1, 0),
    );
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new Markdown(markdown, 1, 1, this.mode.view.messages.getMarkdownThemeWithSettings()),
    );
    this.mode.layout.chatContainer.addChild(new DynamicBorder());
    this.mode.ui.requestRender();
  }

  onGoalStatus(goal: goalTypes.GoalSnapshot | undefined): void {
    const [heading = "", ...rest] = describeGoalStatus(goal, nowMs());
    this.addMutedLines(() =>
      [
        goal === undefined ? theme.fg("muted", heading) : theme.fg("accent", theme.bold(heading)),
        ...rest.map((line) => theme.fg("muted", line)),
      ].join("\n"),
    );
  }
}
