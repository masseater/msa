import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { theme } from "../theme/theme.ts";

const { truncateToWidth } = tui;

export interface PaneResizerOptions {
  height: () => number;
  onDrag: (screenX: number) => void;
}

export class PaneResizer implements tuiTypes.Component {
  private readonly options: PaneResizerOptions;
  private dragging = false;

  constructor(options: PaneResizerOptions) {
    this.options = options;
  }

  render(width: number): string[] {
    const line = truncateToWidth(theme.fg("borderMuted", "│"), Math.max(1, width));
    return Array.from({ length: Math.max(1, this.options.height()) }, () => line);
  }

  handleMouse(event: tuiTypes.TuiMouseEvent): tuiTypes.TuiMouseEventResult | undefined {
    if (event.type === "press" && event.button === "left") {
      this.dragging = true;
      return { capture: true, handled: true };
    }
    if (event.type === "drag" && this.dragging) {
      this.options.onDrag(event.screenX);
      return { handled: true };
    }
    if (event.type === "release") {
      this.dragging = false;
      return { handled: true };
    }
    return undefined;
  }

  invalidate(): void {}
}
