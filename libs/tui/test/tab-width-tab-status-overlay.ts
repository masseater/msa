import type { Component } from "../src/tui-component.ts";

class TabStatusOverlay implements Component {
  render(): string[] {
    return ["\tX"];
  }

  invalidate(): void {}
}

export default TabStatusOverlay;
