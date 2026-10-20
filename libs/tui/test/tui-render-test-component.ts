import { type Component } from "../src/tui-component.ts";

class TestComponent implements Component {
  lines: string[] = [];
  render(_width: number): string[] {
    return this.lines;
  }
  invalidate(): void {}
}

export default TestComponent;
