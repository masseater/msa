import type tuiComponentTypes from "../src/tui-component.types.ts";

class StaticOverlay implements tuiComponentTypes.Component {
  private lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(): string[] {
    return this.lines;
  }

  invalidate(): void {}
}

export default StaticOverlay;
