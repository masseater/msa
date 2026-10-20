import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { BOLD, DIM, MAGENTA, RESET } from "./colors.ts";

const { Input, matchesKey } = tui;

export class InputDialog implements tuiTypes.Component {
  private dialogInput: tuiTypes.Input;
  private title: string;
  onCtrlD?: () => void;

  constructor(title: string, prefill?: string) {
    this.title = title;
    this.dialogInput = new Input();
    if (prefill !== undefined && prefill.length > 0) this.dialogInput.setValue(prefill);
  }

  get onSubmit(): ((value: string) => void) | undefined {
    return this.dialogInput.onSubmit;
  }

  set onSubmit(fn: (value: string) => void) {
    this.dialogInput.onSubmit = fn;
  }

  get onEscape(): (() => void) | undefined {
    return this.dialogInput.onEscape;
  }

  set onEscape(fn: () => void) {
    this.dialogInput.onEscape = fn;
  }

  get inputComponent(): tuiTypes.Input {
    return this.dialogInput;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+d")) {
      this.onCtrlD?.();
      return;
    }
    this.dialogInput.handleInput(data);
  }

  invalidate(): void {
    this.dialogInput.invalidate();
  }

  render(width: number): string[] {
    return [
      `${MAGENTA}${BOLD}${this.title}${RESET}`,
      ...this.dialogInput.render(width),
      `${DIM}Enter to submit, Esc to cancel${RESET}`,
    ];
  }
}
