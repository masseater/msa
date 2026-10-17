import type { Component } from "../src/tui-component.ts";

export class StaticOverlay implements Component {
  private lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(): string[] {
    return this.lines;
  }

  invalidate(): void {}
}
