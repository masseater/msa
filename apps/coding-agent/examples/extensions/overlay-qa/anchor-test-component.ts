import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import BaseOverlay from "./base-overlay.ts";
const { matchesKey } = tui;

export default class AnchorTestComponent extends BaseOverlay {
  private anchor: tuiTypes.OverlayAnchor;
  private done: (result: "next" | "confirm" | "cancel") => void;

  constructor(
    theme: codingAgentTypes.Theme,
    anchor: tuiTypes.OverlayAnchor,
    done: (result: "next" | "confirm" | "cancel") => void,
  ) {
    super(theme);
    this.anchor = anchor;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done("cancel");
    } else if (matchesKey(data, "return")) {
      this.done("confirm");
    } else if (matchesKey(data, "space") || matchesKey(data, "right")) {
      this.done("next");
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    return this.box(
      [
        "",
        ` Current: ${th.fg("accent", this.anchor)}`,
        "",
        ` ${th.fg("dim", "Space/→ = next anchor")}`,
        ` ${th.fg("dim", "Enter = confirm")}`,
        ` ${th.fg("dim", "Esc = cancel")}`,
        "",
      ],
      width,
      "Anchor Test",
    );
  }
}
