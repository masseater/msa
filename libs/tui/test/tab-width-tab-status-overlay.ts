import type { Component } from "../src/tui-component.ts";

export class TabStatusOverlay implements Component {
  render(): string[] {
    return ["\tX"];
  }

  invalidate(): void {}
}
