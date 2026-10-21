import type tuiComponentTypes from "../src/tui-component.types.ts";

class StaticOverlay implements tuiComponentTypes.Component {
  private readonly line: string;

  constructor(line: string) {
    this.line = line;
  }

  render(): string[] {
    return [this.line];
  }

  invalidate(): void {}
}

export default StaticOverlay;
