import {
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@msa/tui";

import { theme } from "../theme/theme.ts";

export interface PaneResizerOptions {
  height: () => number;
  onDrag: (screenX: number) => void;
}

export class PaneResizer implements Component {
  private readonly options: PaneResizerOptions;
  private dragging = false;

  constructor(options: PaneResizerOptions) {
    this.options = options;
  }

  render(width: number): string[] {
    const line = truncateToWidth(theme.fg("borderMuted", "│"), Math.max(1, width));
    return Array.from({ length: Math.max(1, this.options.height()) }, () => line);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "press" && event.button === "left") {
      this.dragging = true;
      return { handled: true, capture: true };
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
