import type { Component } from "../src/tui.ts";

export class EmptyContent implements Component {
  render(): string[] {
    return [];
  }
  invalidate(): void {}
}
