import AssistantMessageComponent from "../components/assistant-message.ts";
import type InteractiveMode from "../interactive-mode.ts";

export default class ThinkingVisibility {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private readonly defaultHiddenThinkingLabel = "Thinking...";

  hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

  hideThinkingBlock = false;

  outputPad = 1;

  setHiddenThinkingLabel(label?: string): void {
    this.hiddenThinkingLabel = label ?? this.defaultHiddenThinkingLabel;
    for (const child of this.mode.view.toolExecutions.chatComponents()) {
      if (child instanceof AssistantMessageComponent) {
        child.setHiddenThinkingLabel(this.hiddenThinkingLabel);
      }
    }
    if (this.mode.view.streaming.streamingComponent !== undefined) {
      this.mode.view.streaming.streamingComponent.setHiddenThinkingLabel(this.hiddenThinkingLabel);
    }
    this.mode.ui.requestRender();
  }

  updateThinkingBlockVisibility(): void {
    for (const child of this.mode.view.toolExecutions.chatComponents()) {
      if (child instanceof AssistantMessageComponent) {
        child.setHideThinkingBlock(this.hideThinkingBlock);
      }
    }
    this.mode.ui.requestRender();
  }

  toggleThinkingBlockVisibility(): void {
    this.hideThinkingBlock = !this.hideThinkingBlock;
    this.mode.settingsManager.display.setHideThinkingBlock(this.hideThinkingBlock);
    this.updateThinkingBlockVisibility();
    this.mode.display.status.showStatus(
      `Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`,
    );
  }

  loadSettings(): void {
    this.hideThinkingBlock = this.mode.settingsManager.display.getHideThinkingBlock();
    this.outputPad = this.mode.settingsManager.terminal.getOutputPad();
  }
}
