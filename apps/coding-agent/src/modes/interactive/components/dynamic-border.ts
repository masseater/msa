import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";

const { theme } = themeModule;

export default class DynamicBorder implements tuiTypes.Component {
  private color: (str: string) => string;

  constructor(color: (str: string) => string = (str) => theme.fg("border", str)) {
    this.color = color;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return [this.color("─".repeat(Math.max(1, width)))];
  }
}
