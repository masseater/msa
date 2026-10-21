import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
const { theme } = themeModule;
const { keyHint } = keybindingHints;
const { Input, getKeybindings, truncateToWidth } = tui;

export default class LabelInput implements tuiTypes.Component, tuiTypes.Focusable {
  private input: tuiTypes.Input;
  private entryId: string;
  public onSubmit?: (entryId: string, label: string | undefined) => void;
  public onCancel?: () => void;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.input.focused = value;
  }

  constructor(entryId: string, currentLabel: string | undefined) {
    this.entryId = entryId;
    this.input = new Input();
    if (currentLabel !== undefined && currentLabel !== "") {
      this.input.setValue(currentLabel);
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const indent = "  ";
    const availableWidth = width - indent.length;
    lines.push(truncateToWidth(`${indent}${theme.fg("muted", "Label (empty to remove):")}`, width));
    lines.push(
      ...this.input
        .render(availableWidth)
        .map((line) => truncateToWidth(`${indent}${line}`, width)),
    );
    lines.push(
      truncateToWidth(
        `${indent}${keyHint("tui.select.confirm", "save")}  ${keyHint("tui.select.cancel", "cancel")}`,
        width,
      ),
    );
    return lines;
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.confirm")) {
      const value = this.input.getValue().trim();
      this.onSubmit?.(this.entryId, value || undefined);
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancel?.();
    } else {
      this.input.handleInput(keyData);
    }
  }
}
