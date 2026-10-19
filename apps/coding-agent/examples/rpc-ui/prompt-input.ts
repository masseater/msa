import { type Component, Input, matchesKey } from "@msa/tui";

import { BOLD, GREEN, RESET } from "./colors.ts";

export class PromptInput implements Component {
  readonly input: Input;
  onCtrlD?: () => void;

  constructor() {
    this.input = new Input();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+d")) {
      this.onCtrlD?.();
      return;
    }
    this.input.handleInput(data);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    return [`${GREEN}${BOLD}You:${RESET}`, ...this.input.render(width)];
  }
}
