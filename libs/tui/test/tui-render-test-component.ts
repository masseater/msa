import { type Component } from "../src/tui.ts";

export class TestComponent implements Component {
  lines: string[] = [];
  render(_width: number): string[] {
    return this.lines;
  }
  invalidate(): void {}
}
