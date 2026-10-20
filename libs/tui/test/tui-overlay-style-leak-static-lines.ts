import type tuiComponentTypes from "../src/tui-component.types.ts";

class StaticLines implements tuiComponentTypes.Component {
  private readonly lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(): string[] {
    return this.lines;
  }

  invalidate(): void {}
}

export default StaticLines;
