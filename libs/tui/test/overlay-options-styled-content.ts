import type { Component } from "../src/tui-component.ts";

class StyledContent implements Component {
  render(width: number): string[] {
    const styledLine = `\x1b[1m\x1b[38;2;255;0;0m${"X".repeat(width)}\x1b[0m`;
    return [styledLine, styledLine, styledLine];
  }
  invalidate(): void {}
}

export default StyledContent;
