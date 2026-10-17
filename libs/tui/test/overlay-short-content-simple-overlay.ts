import type { Component } from "../src/tui.ts";

export class SimpleOverlay implements Component {
  render(): string[] {
    return ["OVERLAY_TOP", "OVERLAY_MID", "OVERLAY_BOT"];
  }
  invalidate() {}
}
