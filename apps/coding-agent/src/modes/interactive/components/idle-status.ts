import type tuiTypes from "@msa/tui/index.types";

export default class IdleStatus implements tuiTypes.Component {
  invalidate(): void {}

  render(width: number): string[] {
    const emptyLine = " ".repeat(width);
    return [emptyLine, emptyLine];
  }
}
