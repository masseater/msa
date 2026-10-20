import type { Component } from "../src/tui-component.ts";

class SimpleOverlay implements Component {
  render(): string[] {
    return ["OVERLAY_TOP", "OVERLAY_MID", "OVERLAY_BOT"];
  }
  invalidate() {}
}

export default SimpleOverlay;
