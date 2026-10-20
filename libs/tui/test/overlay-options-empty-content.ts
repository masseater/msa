import type { Component } from "../src/tui-component.ts";

class EmptyContent implements Component {
  render(): string[] {
    return [];
  }
  invalidate(): void {}
}

export default EmptyContent;
