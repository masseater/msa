import { dual } from "effect/Function";

import { stripOsc133ZonePrefix } from "./ansi-sequences.ts";
import { getActiveBackgroundAnsi } from "./ansi-tracker.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { type LayoutContext, layoutComponent } from "./layout-tree.ts";
import { cropKittyImageLine, getKittyImageMetadata, isImageLine } from "./terminal-image-kitty.ts";
import { getGraphemeCellRange, sliceByColumn } from "./text-slice.ts";
import { type Component, compositeTuiLine } from "./tui-component.ts";
import { extractAnsiCode, visibleWidth } from "./utils.ts";

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutBox {
  component: Component;
  rect: LayoutRect;
  clip: LayoutRect;
  children: LayoutBox[];
  parent?: LayoutBox;
  lines?: readonly string[];
  lineOffset?: number;
  scrollView?: ScrollView;
  scrollContentLines?: readonly string[];
  layer: number;
}

export interface LayoutFrame {
  root: LayoutBox;
  width: number;
  height: number;
  lines: string[];
  primaryScrollView?: ScrollView;
}

export interface ScrollbarGeometry {
  column: number;
  trackTop: number;
  trackHeight: number;
  thumbTop: number;
  thumbHeight: number;
  maxScrollTop: number;
}

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

export const getScrollbarGeometry: {
  (box: LayoutBox, includeHiddenAuto?: boolean): ScrollbarGeometry | undefined;
  (includeHiddenAuto?: boolean): (box: LayoutBox) => ScrollbarGeometry | undefined;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0]),
  (box: LayoutBox, includeHiddenAuto: boolean = false): ScrollbarGeometry | undefined => {
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
      trackTop: box.rect.y,
      trackHeight,
      thumbTop: box.rect.y + thumbOffset,
      thumbHeight,
      maxScrollTop,
    };
  },
);

function paintScrollbar(box: LayoutBox, screen: string[], totalWidth: number): void {
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

function isFullWidthBox(box: LayoutBox, totalWidth: number): boolean {
  return box.rect.x === 0 && box.rect.width >= totalWidth;
}

function clipImageLine(box: LayoutBox, line: string, row: number, screenHeight: number): string {
  const imageMetadata = getKittyImageMetadata(line);
  if (imageMetadata === undefined) return line;
  const clipBottom = Math.min(screenHeight, box.clip.y + box.clip.height);
  const visibleRows = Math.min(imageMetadata.rows, clipBottom - row);
  return visibleRows < imageMetadata.rows ? cropKittyImageLine(line, 0, visibleRows) : line;
}

function paintLine(box: LayoutBox, screen: string[], totalWidth: number, row: number): void {
  const sourceLine = box.lines?.[(box.lineOffset ?? 0) + row - box.rect.y];
  if (sourceLine === undefined) return;
  const line = clipImageLine(box, stripOsc133ZonePrefix(sourceLine), row, screen.length);
  if (
    isFullWidthBox(box, totalWidth) &&
    (isImageLine(line) || screen[row] === undefined || screen[row] === "")
  ) {
    screen[row] = line;
  } else {
    screen[row] = compositeTuiLine(screen[row] ?? "", line, box.rect.x, box.rect.width, totalWidth);
  }
}

function paintLines(box: LayoutBox, screen: string[], totalWidth: number): void {
  if (box.lines === undefined) return;
  const firstRow = Math.max(box.rect.y, box.clip.y, 0);
  const lastRow = Math.min(
    box.rect.y + box.rect.height,
    box.clip.y + box.clip.height,
    screen.length,
  );
  for (let row = firstRow; row < lastRow; row++) paintLine(box, screen, totalWidth, row);
}

interface HiddenImage {
  line: string;
  row: number;
  rows: number;
}

function findImageAboveViewport(lines: readonly string[], top: number): HiddenImage | undefined {
  for (let row = top - 1; row >= 0; row--) {
    const line = lines[row] ?? "";
    const metadata = getKittyImageMetadata(line);
    if (metadata !== undefined) return { line, row, rows: metadata.rows };
    if (line !== "") return undefined;
  }
  return undefined;
}

function paintScrolledImage(box: LayoutBox, screen: string[], totalWidth: number): void {
  const { scrollView, scrollContentLines } = box;
  if (scrollView === undefined || scrollContentLines === undefined || box.rect.height <= 0) return;
  const image = findImageAboveViewport(scrollContentLines, scrollView.scrollTop);
  const hiddenRows = image === undefined ? 0 : scrollView.scrollTop - image.row;
  if (image === undefined || hiddenRows >= image.rows) return;
  const visibleRows = Math.min(box.rect.height, image.rows - hiddenRows);
  const cropped = cropKittyImageLine(image.line, hiddenRows, visibleRows);
  if (isFullWidthBox(box, totalWidth)) screen[box.rect.y] = cropped;
}

function paintBox(box: LayoutBox, screen: string[], totalWidth: number): void {
  paintLines(box, screen, totalWidth);
  for (const child of box.children) paintBox(child, screen, totalWidth);
  paintScrolledImage(box, screen, totalWidth);
  paintScrollbar(box, screen, totalWidth);
}

export const renderLayoutFrame: {
  (root: Component, width: number, height: number, requestRender: () => void): LayoutFrame;
  (width: number, height: number, requestRender: () => void): (root: Component) => LayoutFrame;
} = dual(
  4,
  (root: Component, width: number, height: number, requestRender: () => void): LayoutFrame => {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const context: LayoutContext = {
      viewport: { width: safeWidth, height: safeHeight },
      renderCache: new Map(),
      requestRender,
      primaryScrollView: undefined,
    };
    const rootBox = layoutComponent(context, root, {
      x: 0,
      y: 0,
      width: safeWidth,
      height: safeHeight,
      clip: { x: 0, y: 0, width: safeWidth, height: safeHeight },
    });
    const lines = Array.from({ length: safeHeight }, () => "");
    paintBox(rootBox, lines, safeWidth);
    return {
      root: rootBox,
      width: safeWidth,
      height: safeHeight,
      lines,
      ...(context.primaryScrollView === undefined
        ? {}
        : { primaryScrollView: context.primaryScrollView }),
    };
  },
);

function containsPoint(rect: LayoutRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export const getLayoutBoxesAt: {
  (frame: LayoutFrame, x: number, y: number): LayoutBox[];
  (x: number, y: number): (frame: LayoutFrame) => LayoutBox[];
} = dual(3, (frame: LayoutFrame, x: number, y: number): LayoutBox[] => {
  const result: Array<{ box: LayoutBox; depth: number }> = [];
  const visit = (box: LayoutBox, depth: number): void => {
    if (!containsPoint(box.clip, x, y)) return;
    result.push({ box, depth });
    for (const child of box.children) visit(child, depth + 1);
  };
  visit(frame.root, 0);
  result.sort((a, b) => b.box.layer - a.box.layer || b.depth - a.depth);
  return result.map(({ box }) => box);
});

export const getScrollViewBox: {
  (frame: LayoutFrame, scrollView: ScrollView): LayoutBox | undefined;
  (scrollView: ScrollView): (frame: LayoutFrame) => LayoutBox | undefined;
} = dual(2, (frame: LayoutFrame, scrollView: ScrollView): LayoutBox | undefined => {
  const visit = (box: LayoutBox): LayoutBox | undefined => {
    if (box.scrollView === scrollView) return box;
    for (const child of box.children) {
      const match = visit(child);
      if (match !== undefined) return match;
    }
    return undefined;
  };
  return visit(frame.root);
});

export const getScrollViewsAt: {
  (frame: LayoutFrame, x: number, y: number): ScrollView[];
  (x: number, y: number): (frame: LayoutFrame) => ScrollView[];
} = dual(3, (frame: LayoutFrame, x: number, y: number): ScrollView[] => {
  const result: Array<{ scrollView: ScrollView; depth: number }> = [];
  const visit = (box: LayoutBox, depth: number): void => {
    if (!containsPoint(box.clip, x, y)) return;
    if (box.scrollView !== undefined && containsPoint(box.rect, x, y))
      result.push({ scrollView: box.scrollView, depth });
    for (const child of box.children) visit(child, depth + 1);
  };
  visit(frame.root, 0);
  result.sort((a, b) => b.depth - a.depth);
  return result.map((entry) => entry.scrollView);
});
