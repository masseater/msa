import { dual } from "effect/Function";

import { type SelectionPoint, visibleRows } from "./alt-screen-selection-text.ts";
import type { AltScreenView } from "./alt-screen-view.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { getScrollViewBox } from "./layout.ts";

export interface PointerTarget {
  x: number;
  y: number;
  scrollView?: ScrollView | undefined;
}

export interface ScrollPointerTarget {
  x: number;
  y: number;
  scrollView: ScrollView;
}

export const scrollSelectionPoint: {
  (view: AltScreenView, target: ScrollPointerTarget): SelectionPoint | undefined;
  (target: ScrollPointerTarget): (view: AltScreenView) => SelectionPoint | undefined;
} = dual(2, (view: AltScreenView, target: ScrollPointerTarget): SelectionPoint | undefined => {
  const layout = view.frame.currentLayout;
  if (layout === undefined) return undefined;
  const { scrollView, x, y } = target;
  const box = getScrollViewBox(layout, scrollView);
  const rows = visibleRows(box, view.rows());
  if (box === undefined || rows === undefined || rows.bottom < rows.top) return undefined;
  const pointerRow = Math.max(rows.top, Math.min(rows.bottom, y));
  const maxContentRow = Math.max(0, (box.scrollContentLines?.length ?? 1) - 1);
  return {
    row: Math.max(0, Math.min(maxContentRow, scrollView.scrollTop + pointerRow - box.rect.y)),
    col: Math.max(0, Math.min(box.rect.width - 1, x - box.rect.x)),
    scrollView,
  };
});

export const selectionPointAt: {
  (view: AltScreenView, target: PointerTarget): SelectionPoint;
  (target: PointerTarget): (view: AltScreenView) => SelectionPoint;
} = dual(2, (view: AltScreenView, target: PointerTarget): SelectionPoint => {
  const { scrollView, x, y } = target;
  if (scrollView !== undefined) {
    const point = scrollSelectionPoint(view, { scrollView, x, y });
    if (point !== undefined) return point;
  }
  return {
    row: Math.max(0, Math.min(view.rows() - 1, y)),
    col: Math.max(0, Math.min(view.columns() - 1, x)),
  };
});

export const selectionSourceLine: {
  (view: AltScreenView, point: SelectionPoint): string;
  (point: SelectionPoint): (view: AltScreenView) => string;
} = dual(2, (view: AltScreenView, point: SelectionPoint): string => {
  const { frame } = view;
  if (point.scrollView !== undefined && frame.currentLayout !== undefined) {
    const lines = getScrollViewBox(frame.currentLayout, point.scrollView)?.scrollContentLines;
    if (lines !== undefined) return lines[point.row] ?? "";
  }
  return frame.previousScreen[point.row] ?? "";
});
