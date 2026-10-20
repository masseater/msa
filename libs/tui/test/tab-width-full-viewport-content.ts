import type tuiComponentTypes from "../src/tui-component.types.ts";

class FullViewportContent implements tuiComponentTypes.Component {
  render(width: number): string[] {
    return ["base 0", "base 1", "base 2"].map((line) => line.padEnd(width));
  }

  invalidate(): void {}
}

export default FullViewportContent;
