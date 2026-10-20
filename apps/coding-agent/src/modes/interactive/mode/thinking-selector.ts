import type agentTypes from "@msa/agent-core/index.types";

import defaults from "../../../core/defaults.ts";
import errorsModule from "../../../utils/errors.ts";
import ThinkingSelectorComponent from "../components/thinking-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { toErrorMessage } = errorsModule;
const { DEFAULT_THINKING_LEVEL } = defaults;

export default class ThinkingSelector {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private selectThinkingLevel(level: agentTypes.ThinkingLevel, persist: boolean): void {
    try {
      this.mode.session.models.thinking.setThinkingLevel(level, { persist });
      this.mode.footer.invalidate();
      this.mode.input.keys.updateEditorBorderColor();
      this.mode.display.status.showStatus(
        persist ? `Default thinking level: ${level}` : `Thinking level: ${level}`,
      );
    } catch (error) {
      this.mode.display.status.showError(toErrorMessage(error));
    }
  }

  handleThinkingCommand(searchTerm?: string): void {
    const availableLevels = this.mode.session.models.thinking.getAvailableThinkingLevels();
    if (searchTerm === undefined || searchTerm === "") {
      this.showThinkingSelector();
      return;
    }

    const normalized = searchTerm.trim().toLowerCase();
    const level = availableLevels.find((candidate) => candidate.toLowerCase() === normalized);
    if (level === undefined) {
      this.mode.display.status.showError(
        `Unknown thinking level "${searchTerm}". Available levels: ${availableLevels.join(", ")}.`,
      );
      return;
    }

    this.selectThinkingLevel(level, false);
  }

  private showThinkingSelector(): void {
    this.mode.editorSlot.showSelector((done) => {
      const selectLevel = (level: agentTypes.ThinkingLevel, persist: boolean) => {
        this.selectThinkingLevel(level, persist);
        done();
      };
      const selector = new ThinkingSelectorComponent(
        this.mode.session.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
        this.mode.session.models.thinking.getAvailableThinkingLevels(),
        (level) => selectLevel(level, false),
        () => {
          done();
          this.mode.ui.requestRender();
        },
        (level) => selectLevel(level, true),
        this.mode.settingsManager.models.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
      );
      return { component: selector, focus: selector };
    });
  }
}
