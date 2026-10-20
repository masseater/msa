import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import BaseOverlay from "./base-overlay.ts";
const { matchesKey } = tui;

export default class MarginTestComponent extends BaseOverlay {
  private config: { name: string; options: tuiTypes.OverlayOptions };
  private done: (result: "next" | "close") => void;

  constructor(
    theme: codingAgentTypes.Theme,
    config: { name: string; options: tuiTypes.OverlayOptions },
    done: (result: "next" | "close") => void,
  ) {
    super(theme);
    this.config = config;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done("close");
    } else if (matchesKey(data, "space") || matchesKey(data, "right")) {
      this.done("next");
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    return this.box(
      [
        "",
        ` ${th.fg("accent", this.config.name)}`,
        "",
        ` ${th.fg("dim", "Space/→ = next config")}`,
        ` ${th.fg("dim", "Esc = close")}`,
        "",
      ],
      width,
      "Margin Test",
    );
  }
}
