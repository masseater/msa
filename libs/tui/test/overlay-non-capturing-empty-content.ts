import type { Component } from "../src/tui-component.ts";

export class EmptyContent implements Component {
  render(): string[] {
    return [];
  }
  invalidate(): void {}
}
