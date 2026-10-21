import { dual } from "effect/Function";

import textSlice from "../text-slice.ts";
import tuiComponent from "../tui-component.ts";
import utils from "../utils.ts";
import type editorRenderTypes from "./editor-render.types.ts";
import type editorWrapTypes from "./editor-wrap.types.ts";

const { visibleWidth } = utils;
const { sliceByColumn } = textSlice;
const { CURSOR_MARKER, renderFakeCursor } = tuiComponent;

const editorPadding: {
  (width: number, paddingX: number): editorRenderTypes.EditorPadding;
  (paddingX: number): (width: number) => editorRenderTypes.EditorPadding;
} = dual(2, (width: number, requestedPaddingX: number): editorRenderTypes.EditorPadding => {
  const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
  const paddingX = Math.min(requestedPaddingX, maxPadding);
  return { contentWidth: Math.max(1, width - paddingX * 2), paddingX };
});

function clampScrollOffset({
  layoutLines,
  scrollOffset,
  maxVisibleLines,
}: editorRenderTypes.ScrollWindow): number {
  let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
  if (cursorLineIndex === -1) cursorLineIndex = 0;
  let offset = scrollOffset;
  if (cursorLineIndex < offset) {
    offset = cursorLineIndex;
  } else if (cursorLineIndex >= offset + maxVisibleLines) {
    offset = cursorLineIndex - maxVisibleLines + 1;
  }
  const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
  return Math.max(0, Math.min(offset, maxScrollOffset));
}

const createScrollBorder: {
  (direction: "↑" | "↓", hiddenLineCount: number, width: number): string;
  (hiddenLineCount: number, width: number): (direction: "↑" | "↓") => string;
} = dual(3, (direction: "↑" | "↓", hiddenLineCount: number, width: number): string => {
  const availableWidth = Math.max(0, width);
  const label = ` ${direction} ${hiddenLineCount} more `;
  const labelWidth = visibleWidth(label);
  if (labelWidth + 2 <= availableWidth) {
    const leftWidth = Math.floor((availableWidth - labelWidth) / 2);
    return "─".repeat(leftWidth) + label + "─".repeat(availableWidth - leftWidth - labelWidth);
  }

  const indicator = `─── ${direction} ${hiddenLineCount} more `;
  const remaining = availableWidth - visibleWidth(indicator);
  if (remaining >= 0) return indicator + "─".repeat(remaining);

  const ellipsis = "...".slice(0, availableWidth);
  const indicatorWidth = availableWidth - visibleWidth(ellipsis);
  return sliceByColumn(indicator, 0, indicatorWidth, true) + ellipsis;
});

interface CursorLineText {
  text: string;
  width: number;
  cursorAtEnd: boolean;
}

function withCursor(
  layoutLine: editorWrapTypes.LayoutLine,
  frame: editorRenderTypes.EditorContentFrame,
): CursorLineText {
  const width = visibleWidth(layoutLine.text);
  if (!layoutLine.hasCursor || layoutLine.cursorPos === undefined) {
    return { cursorAtEnd: false, text: layoutLine.text, width };
  }
  const before = layoutLine.text.slice(0, layoutLine.cursorPos);
  const after = layoutLine.text.slice(layoutLine.cursorPos);
  const marker = frame.focused ? CURSOR_MARKER : "";
  if (after.length === 0) {
    return { cursorAtEnd: true, text: before + marker + renderFakeCursor(" "), width: width + 1 };
  }
  const firstGrapheme = frame.graphemes(after)[0]?.segment || "";
  return {
    cursorAtEnd: false,
    text: before + marker + renderFakeCursor(firstGrapheme) + after.slice(firstGrapheme.length),
    width,
  };
}

const renderContentLines: {
  (
    lines: readonly editorWrapTypes.LayoutLine[],
    frame: editorRenderTypes.EditorContentFrame,
  ): string[];
  (
    frame: editorRenderTypes.EditorContentFrame,
  ): (lines: readonly editorWrapTypes.LayoutLine[]) => string[];
} = dual(
  2,
  (
    lines: readonly editorWrapTypes.LayoutLine[],
    frame: editorRenderTypes.EditorContentFrame,
  ): string[] => {
    const sidePadding = " ".repeat(frame.paddingX);
    return lines.map((layoutLine) => {
      const line = withCursor(layoutLine, frame);
      const cursorInPadding =
        line.cursorAtEnd && line.width > frame.contentWidth && frame.paddingX > 0;
      const padding = " ".repeat(Math.max(0, frame.contentWidth - line.width));
      const rightPadding = cursorInPadding ? sidePadding.slice(1) : sidePadding;
      return `${sidePadding}${line.text}${padding}${rightPadding}`;
    });
  },
);

const padContentLines: {
  (lines: readonly string[], frame: editorRenderTypes.EditorPadding): string[];
  (frame: editorRenderTypes.EditorPadding): (lines: readonly string[]) => string[];
} = dual(2, (lines: readonly string[], frame: editorRenderTypes.EditorPadding): string[] => {
  const sidePadding = " ".repeat(frame.paddingX);
  return lines.map((line) => {
    const linePadding = " ".repeat(Math.max(0, frame.contentWidth - visibleWidth(line)));
    return `${sidePadding}${line}${linePadding}${sidePadding}`;
  });
});

const editorRender = {
  clampScrollOffset,
  createScrollBorder,
  editorPadding,
  padContentLines,
  renderContentLines,
};

export default editorRender;
