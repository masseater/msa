import type { Component } from "../src/tui.ts";

export class SimpleContent implements Component {
  private lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(): string[] {
    return this.lines;
  }
  invalidate() {}
}
