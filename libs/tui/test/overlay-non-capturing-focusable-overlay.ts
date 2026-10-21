import type tuiComponentTypes from "../src/tui-component.types.ts";

class FocusableOverlay implements tuiComponentTypes.Component, tuiComponentTypes.Focusable {
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

export default FocusableOverlay;
