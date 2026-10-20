import tui from "@msa/tui";

import type treeListInternalTypes from "./tree-list-internal.types.ts";

const { sliceByColumn, truncateToWidth } = tui;

const TREE_GUTTER_WIDTH = 2;

const MIN_VISIBLE_ANCHOR_CONTENT_WIDTH = 4;

const MAX_VISIBLE_ANCHOR_CONTENT_WIDTH = 20;

const MIN_ANCHOR_CONTEXT_WIDTH = 2;

const MAX_ANCHOR_CONTEXT_WIDTH = 12;

function renderHorizontalViewport(
  rows: treeListInternalTypes.HorizontalViewportRow[],
  width: number,
): string[] {
  const viewportWidth = Math.max(0, width - TREE_GUTTER_WIDTH);
  const maxBodyWidth = rows.reduce((max, row) => Math.max(max, row.bodyWidth), 0);
  const maxHorizontalScroll = Math.max(0, maxBodyWidth - viewportWidth);
  const selectedRow = rows.find((row) => row.isSelected);

  let horizontalScroll = 0;
  if (selectedRow !== undefined && maxHorizontalScroll > 0) {
    const minVisibleAnchorContentWidth = Math.min(
      MAX_VISIBLE_ANCHOR_CONTENT_WIDTH,
      Math.max(MIN_VISIBLE_ANCHOR_CONTENT_WIDTH, Math.floor(viewportWidth / 3)),
    );
    if (selectedRow.anchorCol > viewportWidth - minVisibleAnchorContentWidth) {
      const anchorContextWidth = Math.min(
        MAX_ANCHOR_CONTEXT_WIDTH,
        Math.max(MIN_ANCHOR_CONTEXT_WIDTH, Math.floor(viewportWidth / 4)),
      );
      horizontalScroll = Math.min(maxHorizontalScroll, selectedRow.anchorCol - anchorContextWidth);
    }
  }

  return rows.map((row) => {
    const line =
      horizontalScroll > 0
        ? `${row.gutter}${sliceByColumn(row.body, horizontalScroll, viewportWidth, true)}\x1b[0m`
        : row.gutter + row.body;
    return truncateToWidth(line, width, "");
  });
}

const treeListHelpers = {
  MAX_ANCHOR_CONTEXT_WIDTH,
  MAX_VISIBLE_ANCHOR_CONTENT_WIDTH,
  MIN_ANCHOR_CONTEXT_WIDTH,
  MIN_VISIBLE_ANCHOR_CONTENT_WIDTH,
  TREE_GUTTER_WIDTH,
  renderHorizontalViewport,
};

export default treeListHelpers;
