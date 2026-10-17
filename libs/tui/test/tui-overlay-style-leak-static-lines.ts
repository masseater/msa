import type { Component } from "../src/tui-component.ts";

export class StaticLines implements Component {
  private readonly lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(): string[] {
    return this.lines;
  }

  invalidate(): void {}
}
