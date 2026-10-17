import type { Component } from "../src/tui.ts";

export class TabStatusOverlay implements Component {
  render(): string[] {
    return ["\tX"];
  }

  invalidate(): void {}
}
