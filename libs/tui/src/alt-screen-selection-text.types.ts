import type scrollViewTypes from "./components/scroll-view.types.ts";

declare namespace altScreenSelectionTextTypes {
  interface SelectionPoint {
    row: number;
    col: number;
    scrollView?: scrollViewTypes.ScrollView;
    boundary?: boolean;
  }

  interface SelectionRange {
    start: SelectionPoint;
    end: SelectionPoint;
  }

  interface SelectionWindow {
    row: number;
    selection: SelectionRange;
    minColumn?: number;
    maxColumn?: number;
  }

  interface SelectionPaint {
    selection: SelectionRange;
    minRow: number;
    maxRow: number;
    minColumn: number;
    maxColumn: number;
  }

  interface VisibleRows {
    top: number;
    bottom: number;
  }
}

export type { altScreenSelectionTextTypes as default };
