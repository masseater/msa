import type { Component } from "../src/tui-component.ts";

class FullViewportContent implements Component {
  render(width: number): string[] {
    return ["base 0", "base 1", "base 2"].map((line) => line.padEnd(width));
  }

  invalidate(): void {}
}

export default FullViewportContent;
