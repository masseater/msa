import type PaneResizerClass from "./pane-resizer.ts";

declare namespace paneResizerTypes {
  interface PaneResizerOptions {
    height: () => number;
    onDrag: (screenX: number) => void;
  }

  type PaneResizer = (typeof PaneResizerClass)["prototype"];
}

export type { paneResizerTypes as default };
