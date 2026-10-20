import { dual } from "effect/Function";

import type scrollViewTypes from "./components/scroll-view.types.ts";
import layoutKit from "./layout-kit.ts";
import layoutScrollbar from "./layout-scrollbar.ts";
import type layoutTreeTypes from "./layout-tree.types.ts";
import type layoutTypes from "./layout.types.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import tuiComponent from "./tui-component.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

const { getScrollbarGeometry, paintScrollbar } = layoutScrollbar;

const { ansiSequences, layoutTree } = layoutKit;
const { cropKittyImageLine, getKittyImageMetadata, isImageLine } = terminalImageKitty;

const { stripOsc133ZonePrefix } = ansiSequences;
const { compositeTuiLine } = tuiComponent;
const { layoutComponent } = layoutTree;

function isFullWidthBox(box: layoutTypes.LayoutBox, totalWidth: number): boolean {
  return box.rect.x === 0 && box.rect.width >= totalWidth;
}

function clipImageLine(
  box: layoutTypes.LayoutBox,
  line: string,
  row: number,
  screenHeight: number,
): string {
  const imageMetadata = getKittyImageMetadata(line);
  if (imageMetadata === undefined) return line;
  const clipBottom = Math.min(screenHeight, box.clip.y + box.clip.height);
  const visibleRows = Math.min(imageMetadata.rows, clipBottom - row);
  return visibleRows < imageMetadata.rows ? cropKittyImageLine(line, 0, visibleRows) : line;
}

function paintLine(
  box: layoutTypes.LayoutBox,
  screen: string[],
  totalWidth: number,
  row: number,
): void {
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

function paintLines(box: layoutTypes.LayoutBox, screen: string[], totalWidth: number): void {
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

function paintScrolledImage(
  box: layoutTypes.LayoutBox,
  screen: string[],
  totalWidth: number,
): void {
  const { scrollView, scrollContentLines } = box;
  if (scrollView === undefined || scrollContentLines === undefined || box.rect.height <= 0) return;
  const image = findImageAboveViewport(scrollContentLines, scrollView.scrollTop);
  const hiddenRows = image === undefined ? 0 : scrollView.scrollTop - image.row;
  if (image === undefined || hiddenRows >= image.rows) return;
  const visibleRows = Math.min(box.rect.height, image.rows - hiddenRows);
  const cropped = cropKittyImageLine(image.line, hiddenRows, visibleRows);
  if (isFullWidthBox(box, totalWidth)) screen[box.rect.y] = cropped;
}

function paintBox(box: layoutTypes.LayoutBox, screen: string[], totalWidth: number): void {
  paintLines(box, screen, totalWidth);
  for (const child of box.children) paintBox(child, screen, totalWidth);
  paintScrolledImage(box, screen, totalWidth);
  paintScrollbar(box, screen, totalWidth);
}

const renderLayoutFrame: {
  (
    root: tuiComponentTypes.Component,
    width: number,
    height: number,
    requestRender: () => void,
  ): layoutTypes.LayoutFrame;
  (
    width: number,
    height: number,
    requestRender: () => void,
  ): (root: tuiComponentTypes.Component) => layoutTypes.LayoutFrame;
} = dual(
  4,
  (
    root: tuiComponentTypes.Component,
    width: number,
    height: number,
    requestRender: () => void,
  ): layoutTypes.LayoutFrame => {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const context: layoutTreeTypes.LayoutContext = {
      primaryScrollView: undefined,
      renderCache: new Map(),
      requestRender,
      viewport: { height: safeHeight, width: safeWidth },
    };
    const rootBox = layoutComponent(context, root, {
      clip: { height: safeHeight, width: safeWidth, x: 0, y: 0 },
      height: safeHeight,
      width: safeWidth,
      x: 0,
      y: 0,
    });
    const lines = Array.from({ length: safeHeight }, () => "");
    paintBox(rootBox, lines, safeWidth);
    return {
      height: safeHeight,
      lines,
      root: rootBox,
      width: safeWidth,
      ...(context.primaryScrollView === undefined
        ? {}
        : { primaryScrollView: context.primaryScrollView }),
    };
  },
);

function containsPoint(rect: layoutTypes.LayoutRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

const getLayoutBoxesAt: {
  (frame: layoutTypes.LayoutFrame, x: number, y: number): layoutTypes.LayoutBox[];
  (x: number, y: number): (frame: layoutTypes.LayoutFrame) => layoutTypes.LayoutBox[];
} = dual(3, (frame: layoutTypes.LayoutFrame, x: number, y: number): layoutTypes.LayoutBox[] => {
  const result: Array<{ box: layoutTypes.LayoutBox; depth: number }> = [];
  const visit = (box: layoutTypes.LayoutBox, depth: number): void => {
    if (!containsPoint(box.clip, x, y)) return;
    result.push({ box, depth });
    for (const child of box.children) visit(child, depth + 1);
  };
  visit(frame.root, 0);
  result.sort((a, b) => b.box.layer - a.box.layer || b.depth - a.depth);
  return result.map(({ box }) => box);
});

const getScrollViewBox: {
  (
    frame: layoutTypes.LayoutFrame,
    scrollView: scrollViewTypes.ScrollView,
  ): layoutTypes.LayoutBox | undefined;
  (
    scrollView: scrollViewTypes.ScrollView,
  ): (frame: layoutTypes.LayoutFrame) => layoutTypes.LayoutBox | undefined;
} = dual(
  2,
  (
    frame: layoutTypes.LayoutFrame,
    scrollView: scrollViewTypes.ScrollView,
  ): layoutTypes.LayoutBox | undefined => {
    const visit = (box: layoutTypes.LayoutBox): layoutTypes.LayoutBox | undefined => {
      if (box.scrollView === scrollView) return box;
      for (const child of box.children) {
        const match = visit(child);
        if (match !== undefined) return match;
      }
      return undefined;
    };
    return visit(frame.root);
  },
);

const getScrollViewsAt: {
  (frame: layoutTypes.LayoutFrame, x: number, y: number): scrollViewTypes.ScrollView[];
  (x: number, y: number): (frame: layoutTypes.LayoutFrame) => scrollViewTypes.ScrollView[];
} = dual(
  3,
  (frame: layoutTypes.LayoutFrame, x: number, y: number): scrollViewTypes.ScrollView[] => {
    const result: Array<{ scrollView: scrollViewTypes.ScrollView; depth: number }> = [];
    const visit = (box: layoutTypes.LayoutBox, depth: number): void => {
      if (!containsPoint(box.clip, x, y)) return;
      if (box.scrollView !== undefined && containsPoint(box.rect, x, y))
        result.push({ depth, scrollView: box.scrollView });
      for (const child of box.children) visit(child, depth + 1);
    };
    visit(frame.root, 0);
    result.sort((a, b) => b.depth - a.depth);
    return result.map((entry) => entry.scrollView);
  },
);

const layout = {
  getLayoutBoxesAt,
  getScrollViewBox,
  getScrollViewsAt,
  getScrollbarGeometry,
  renderLayoutFrame,
};

export default layout;
