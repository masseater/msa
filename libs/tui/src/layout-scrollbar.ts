import { dual } from "effect/Function";

import layoutKit from "./layout-kit.ts";
import type layoutTypes from "./layout.types.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import textSlice from "./text-slice.ts";
import utils from "./utils.ts";

const { ansiTracker } = layoutKit;
const { isImageLine } = terminalImageKitty;
const { getGraphemeCellRange, sliceByColumn } = textSlice;
const { extractAnsiCode, visibleWidth } = utils;
const { getActiveBackgroundAnsi } = ansiTracker;

function replaceScrollbarCell(
  line: string,
  column: number,
  totalWidth: number,
  replacement: string,
  preserveTargetBackground: boolean,
): string {
  if (isImageLine(line)) return line;

  const graphemeRange = getGraphemeCellRange(line, column);
  const start = graphemeRange?.start ?? column;
  const end = graphemeRange?.end ?? column + 1;
  const before = sliceByColumn(line, 0, start, true);
  const target = sliceByColumn(line, start, end - start, true);
  const after = sliceByColumn(line, end, Math.max(0, totalWidth - end), true);

  let targetPrefix = "";
  let targetIndex = 0;
  while (targetIndex < target.length) {
    const ansi = extractAnsiCode(target, targetIndex);
    if (ansi === null) break;
    targetPrefix += ansi.code;
    targetIndex += ansi.length;
  }
  const beforePadding = " ".repeat(Math.max(0, start - visibleWidth(before)));
  const cellPaddingBefore = " ".repeat(Math.max(0, column - start));
  const cellPaddingAfter = " ".repeat(Math.max(0, end - column - 1));
  const targetStyle = `\x1b[0m\x1b]8;;\x07${preserveTargetBackground ? getActiveBackgroundAnsi(targetPrefix) : ""}`;
  return `${before}${beforePadding}${targetStyle}${cellPaddingBefore}${replacement}${cellPaddingAfter}${after}`;
}

const getScrollbarGeometry: {
  (
    box: layoutTypes.LayoutBox,
    includeHiddenAuto?: boolean,
  ): layoutTypes.ScrollbarGeometry | undefined;
  (
    includeHiddenAuto?: boolean,
  ): (box: layoutTypes.LayoutBox) => layoutTypes.ScrollbarGeometry | undefined;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0]),
  (
    box: layoutTypes.LayoutBox,
    includeHiddenAuto: boolean = false,
  ): layoutTypes.ScrollbarGeometry | undefined => {
    if (box.scrollView === undefined || box.rect.width <= 0 || box.rect.height <= 0)
      return undefined;

    const contentHeight = box.children[0]?.rect.height ?? box.scrollContentLines?.length ?? 0;
    const trackHeight = box.rect.height;
    const canRevealHiddenAuto =
      includeHiddenAuto && box.scrollView.scrollbar === "auto" && contentHeight > trackHeight;
    if (!box.scrollView.isScrollbarVisible && !canRevealHiddenAuto) return undefined;

    const minThumbHeight = Math.min(2, trackHeight);
    const thumbHeight = Math.max(
      minThumbHeight,
      Math.min(trackHeight, Math.round((trackHeight * trackHeight) / contentHeight)),
    );
    const maxScrollTop = Math.max(0, contentHeight - trackHeight);
    const maxThumbTop = trackHeight - thumbHeight;
    const thumbOffset =
      maxScrollTop === 0 ? 0 : Math.round((box.scrollView.scrollTop / maxScrollTop) * maxThumbTop);
    const column = box.rect.x + box.rect.width - 1;
    if (column < box.clip.x || column >= box.clip.x + box.clip.width) return undefined;

    return {
      column,
      maxScrollTop,
      thumbHeight,
      thumbTop: box.rect.y + thumbOffset,
      trackHeight,
      trackTop: box.rect.y,
    };
  },
);

function paintScrollbar(box: layoutTypes.LayoutBox, screen: string[], totalWidth: number): void {
  const geometry = getScrollbarGeometry(box);
  if (geometry === undefined || box.scrollView === undefined) return;

  for (let offset = 0; offset < geometry.trackHeight; offset++) {
    const row = geometry.trackTop + offset;
    if (row < box.clip.y || row >= box.clip.y + box.clip.height || row < 0 || row >= screen.length)
      continue;
    const isThumb = row >= geometry.thumbTop && row < geometry.thumbTop + geometry.thumbHeight;
    const replacement = isThumb
      ? box.scrollView.scrollbarThumbStyle(box.scrollView.isScrollbarActive ? "█" : "┃")
      : box.scrollView.scrollbarTrackStyle("│");
    screen[row] = replaceScrollbarCell(
      screen[row] ?? "",
      geometry.column,
      totalWidth,
      replacement,
      box.scrollView.scrollbar !== "always",
    );
  }
}

const layoutScrollbar = {
  getScrollbarGeometry,
  paintScrollbar,
  replaceScrollbarCell,
};

export default layoutScrollbar;
