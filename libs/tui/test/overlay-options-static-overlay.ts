import type tuiComponentTypes from "../src/tui-component.types.ts";

class StaticOverlay implements tuiComponentTypes.Component {
  private lines: string[];
  requestedWidth?: number | undefined;

  constructor(lines: string[], requestedWidth?: number) {
    this.lines = lines;
    this.requestedWidth = requestedWidth;
  }

  render(width: number): string[] {
    this.requestedWidth = width;
    return this.lines;
  }

  invalidate(): void {}
}

export default StaticOverlay;
