import type { Component } from "../src/tui-component.ts";

class HyperlinkContent implements Component {
  render(width: number): string[] {
    const link = `\x1b]8;;file:///path/to/file.ts\x07file.ts\x1b]8;;\x07`;
    const line = `See ${link} for details ${"X".repeat(width - 30)}`;
    return [line, line, line];
  }
  invalidate(): void {}
}

export default HyperlinkContent;
