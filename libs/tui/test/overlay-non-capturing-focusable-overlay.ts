import type { Component, Focusable } from "../src/tui.ts";

export class FocusableOverlay implements Component, Focusable {
  focused = false;
  inputs: string[] = [];
  private lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  render(): string[] {
    return this.lines;
  }

  invalidate(): void {}
}
