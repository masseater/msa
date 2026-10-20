import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";

import BaseOverlay from "./base-overlay.ts";
const { matchesKey } = tui;

export default class MaxHeightTestComponent extends BaseOverlay {
  private done: () => void;

  constructor(theme: codingAgentTypes.Theme, done: () => void) {
    super(theme);
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
    }
  }

  render(width: number): string[] {
    const th = this.theme;

    const contentLines: string[] = [
      th.fg("warning", " ⚠ Rendering 21 lines, maxHeight: 10"),
      th.fg("dim", " Lines 11-21 truncated (no bottom border)"),
      "",
    ];

    for (let i = 1; i <= 14; i++) {
      contentLines.push(` Line ${i} of 14`);
    }

    contentLines.push("", th.fg("dim", " Press Esc to close"));

    return this.box(contentLines, width, "MaxHeight Test");
  }
}
