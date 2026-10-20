import type tuiComponentTypes from "../src/tui-component.types.ts";

class SimpleContent implements tuiComponentTypes.Component {
  private lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(): string[] {
    return this.lines;
  }
  invalidate() {}
}

export default SimpleContent;
