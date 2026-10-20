import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { BOLD, GREEN, RESET } from "./colors.ts";

const { Input, matchesKey } = tui;

export class PromptInput implements tuiTypes.Component {
  readonly input: tuiTypes.Input;
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
