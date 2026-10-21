import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";

import BaseOverlay from "./base-overlay.ts";
const { matchesKey } = tui;

export default class EdgeTestComponent extends BaseOverlay {
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
    return this.box(
      [
        "",
        " This overlay is at the",
        " right edge of terminal.",
        "",
        ` ${th.fg("dim", "Verify right border")}`,
        ` ${th.fg("dim", "aligns with edge.")}`,
        "",
        ` ${th.fg("dim", "Press Esc to close")}`,
        "",
      ],
      width,
      "Edge Test",
    );
  }
}
