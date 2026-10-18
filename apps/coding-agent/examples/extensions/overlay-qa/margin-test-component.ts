import type { Theme } from "@msa/coding-agent";
import type { OverlayOptions } from "@msa/tui";
import { matchesKey } from "@msa/tui";

import { BaseOverlay } from "./base-overlay.ts";

export class MarginTestComponent extends BaseOverlay {
  private config: { name: string; options: OverlayOptions };
  private done: (result: "next" | "close") => void;

  constructor(
    theme: Theme,
    config: { name: string; options: OverlayOptions },
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
