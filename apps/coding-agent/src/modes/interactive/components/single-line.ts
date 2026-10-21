import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
const { truncateToWidth } = tui;

export default class SingleLine implements tuiTypes.Component {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  render(width: number): string[] {
    return [truncateToWidth(this.text, width, "...")];
  }

  invalidate(): void {}
}
