import { dual } from "effect/Function";

import type altScreenSelectionPointsTypes from "./alt-screen-selection-points.types.ts";
import altScreenSelectionText from "./alt-screen-selection-text.ts";
import type altScreenSelectionTextTypes from "./alt-screen-selection-text.types.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";
import layoutModule from "./layout.ts";

const { getScrollViewBox } = layoutModule;
const { visibleRows } = altScreenSelectionText;

const scrollSelectionPoint: {
  (
    view: altScreenViewTypes.AltScreenView,
    target: altScreenSelectionPointsTypes.ScrollPointerTarget,
  ): altScreenSelectionTextTypes.SelectionPoint | undefined;
  (
    target: altScreenSelectionPointsTypes.ScrollPointerTarget,
  ): (
    view: altScreenViewTypes.AltScreenView,
  ) => altScreenSelectionTextTypes.SelectionPoint | undefined;
} = dual(
  2,
  (
    view: altScreenViewTypes.AltScreenView,
    target: altScreenSelectionPointsTypes.ScrollPointerTarget,
  ): altScreenSelectionTextTypes.SelectionPoint | undefined => {
    const layout = view.frame.currentLayout;
    if (layout === undefined) return undefined;
    const { scrollView, x, y } = target;
    const box = getScrollViewBox(layout, scrollView);
    const rows = visibleRows(box, view.rows());
    if (box === undefined || rows === undefined || rows.bottom < rows.top) return undefined;
    const pointerRow = Math.max(rows.top, Math.min(rows.bottom, y));
    const maxContentRow = Math.max(0, (box.scrollContentLines?.length ?? 1) - 1);
    return {
      col: Math.max(0, Math.min(box.rect.width - 1, x - box.rect.x)),
      row: Math.max(0, Math.min(maxContentRow, scrollView.scrollTop + pointerRow - box.rect.y)),
      scrollView,
    };
  },
);

const selectionPointAt: {
  (
    view: altScreenViewTypes.AltScreenView,
    target: altScreenSelectionPointsTypes.PointerTarget,
  ): altScreenSelectionTextTypes.SelectionPoint;
  (
    target: altScreenSelectionPointsTypes.PointerTarget,
  ): (view: altScreenViewTypes.AltScreenView) => altScreenSelectionTextTypes.SelectionPoint;
} = dual(
  2,
  (
    view: altScreenViewTypes.AltScreenView,
    target: altScreenSelectionPointsTypes.PointerTarget,
  ): altScreenSelectionTextTypes.SelectionPoint => {
    const { scrollView, x, y } = target;
    if (scrollView !== undefined) {
      const point = scrollSelectionPoint(view, { scrollView, x, y });
      if (point !== undefined) return point;
    }
    return {
      col: Math.max(0, Math.min(view.columns() - 1, x)),
      row: Math.max(0, Math.min(view.rows() - 1, y)),
    };
  },
);

const selectionSourceLine: {
  (
    view: altScreenViewTypes.AltScreenView,
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): string;
  (
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): (view: altScreenViewTypes.AltScreenView) => string;
} = dual(
  2,
  (
    view: altScreenViewTypes.AltScreenView,
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): string => {
    const { frame } = view;
    if (point.scrollView !== undefined && frame.currentLayout !== undefined) {
      const lines = getScrollViewBox(frame.currentLayout, point.scrollView)?.scrollContentLines;
      if (lines !== undefined) return lines[point.row] ?? "";
    }
    return frame.previousScreen[point.row] ?? "";
  },
);

const altScreenSelectionPoints = {
  scrollSelectionPoint,
  selectionPointAt,
  selectionSourceLine,
};

export default altScreenSelectionPoints;
