import type { Component } from "../src/tui-component.ts";

export class StaticOverlay implements Component {
  private readonly line: string;

  constructor(line: string) {
    this.line = line;
  }

  render(): string[] {
    return [this.line];
  }

  invalidate(): void {}
}
