import type tuiComponentTypes from "../src/tui-component.types.ts";

class SimpleOverlay implements tuiComponentTypes.Component {
  render(): string[] {
    return ["OVERLAY_TOP", "OVERLAY_MID", "OVERLAY_BOT"];
  }
  invalidate() {}
}

export default SimpleOverlay;
