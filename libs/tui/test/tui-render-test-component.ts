import type tuiComponentTypes from "../src/tui-component.types.ts";

class TestComponent implements tuiComponentTypes.Component {
  lines: string[] = [];
  render(_width: number): string[] {
    return this.lines;
  }
  invalidate(): void {}
}

export default TestComponent;
