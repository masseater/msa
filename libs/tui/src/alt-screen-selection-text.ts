import { dual } from "effect/Function";

import type altScreenSelectionTextTypes from "./alt-screen-selection-text.types.ts";
import type layoutTypes from "./layout.types.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import textSlice from "./text-slice.ts";
import utils from "./utils.ts";

const { extractAnsiCode, getWordSegmenter, stripTerminalSequences, visibleWidth } = utils;
const { getGraphemeCellRange, sliceByColumn } = textSlice;
const { isImageLine } = terminalImageKitty;

const TERMINAL_WORD_SELECTION_JOINERS = new Set(["/", "-"]);
const wordSegmenter = getWordSegmenter();

interface WordSegment {
  start: number;
  end: number;
  selectable: boolean;
  joiner: boolean;
}

function wordSegments(line: string): WordSegment[] {
  const segments: WordSegment[] = [];
  let start = 0;
  for (const segment of wordSegmenter.segment(line)) {
    const end = start + visibleWidth(segment.segment);
    const joiner = TERMINAL_WORD_SELECTION_JOINERS.has(segment.segment);
    segments.push({ end, joiner, selectable: segment.isWordLike === true || joiner, start });
    start = end;
  }
  return segments;
}

function canJoin(left: WordSegment, right: WordSegment): boolean {
  return left.selectable && right.selectable && (left.joiner || right.joiner);
}

const visibleRows: {
  (
    box: layoutTypes.LayoutBox | undefined,
    terminalRows: number,
  ): altScreenSelectionTextTypes.VisibleRows | undefined;
  (
    terminalRows: number,
  ): (
    box: layoutTypes.LayoutBox | undefined,
  ) => altScreenSelectionTextTypes.VisibleRows | undefined;
} = dual(
  2,
  (
    box: layoutTypes.LayoutBox | undefined,
    terminalRows: number,
  ): altScreenSelectionTextTypes.VisibleRows | undefined => {
    if (box === undefined || box.rect.height <= 0 || box.clip.height <= 0) return undefined;
    return {
      bottom: Math.min(
        terminalRows - 1,
        box.rect.y + box.rect.height - 1,
        box.clip.y + box.clip.height - 1,
      ),
      top: Math.max(0, box.rect.y, box.clip.y),
    };
  },
);

const wordSelection: {
  (
    line: string,
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): altScreenSelectionTextTypes.SelectionRange | undefined;
  (
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): (line: string) => altScreenSelectionTextTypes.SelectionRange | undefined;
} = dual(
  2,
  (
    line: string,
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): altScreenSelectionTextTypes.SelectionRange | undefined => {
    const segments = wordSegments(stripTerminalSequences(line));
    const clickedSegmentIndex = segments.findIndex(
      (segment) => point.col >= segment.start && point.col < segment.end,
    );
    const clicked = segments[clickedSegmentIndex];
    if (clicked === undefined) return undefined;

    let selectionStart = clicked.start;
    let selectionEnd = clicked.end;
    let current = clicked;
    for (const previous of segments.slice(0, clickedSegmentIndex).reverse()) {
      if (!canJoin(previous, current)) break;
      selectionStart = previous.start;
      current = previous;
    }
    current = clicked;
    for (const next of segments.slice(clickedSegmentIndex + 1)) {
      if (!canJoin(current, next)) break;
      selectionEnd = next.end;
      current = next;
    }
    return {
      end: { ...point, boundary: true, col: selectionEnd },
      start: { ...point, col: selectionStart },
    };
  },
);

const lineSelection: {
  (
    line: string,
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): altScreenSelectionTextTypes.SelectionRange;
  (
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): (line: string) => altScreenSelectionTextTypes.SelectionRange;
} = dual(
  2,
  (
    line: string,
    point: altScreenSelectionTextTypes.SelectionPoint,
  ): altScreenSelectionTextTypes.SelectionRange => ({
    end: { ...point, boundary: true, col: visibleWidth(line) },
    start: { ...point, col: 0 },
  }),
);

const orderedSelection: {
  (
    anchor: altScreenSelectionTextTypes.SelectionPoint,
    focus: altScreenSelectionTextTypes.SelectionPoint,
  ): altScreenSelectionTextTypes.SelectionRange | undefined;
  (
    focus: altScreenSelectionTextTypes.SelectionPoint,
  ): (
    anchor: altScreenSelectionTextTypes.SelectionPoint,
  ) => altScreenSelectionTextTypes.SelectionRange | undefined;
} = dual(
  2,
  (
    anchor: altScreenSelectionTextTypes.SelectionPoint,
    focus: altScreenSelectionTextTypes.SelectionPoint,
  ): altScreenSelectionTextTypes.SelectionRange | undefined => {
    if (anchor.scrollView !== focus.scrollView) return undefined;
    if (anchor.row === focus.row && anchor.col === focus.col) return undefined;
    const anchorBeforeFocus =
      anchor.row < focus.row || (anchor.row === focus.row && anchor.col < focus.col);
    return anchorBeforeFocus ? { end: focus, start: anchor } : { end: anchor, start: focus };
  },
);

const selectionColumns: {
  (
    line: string,
    window: altScreenSelectionTextTypes.SelectionWindow,
  ): { start: number; end: number };
  (
    window: altScreenSelectionTextTypes.SelectionWindow,
  ): (line: string) => { start: number; end: number };
} = dual(
  2,
  (
    line: string,
    window: altScreenSelectionTextTypes.SelectionWindow,
  ): { start: number; end: number } => {
    const { row, selection } = window;
    const lineWidth = visibleWidth(line);
    const minColumn = window.minColumn ?? 0;
    const maxColumn = window.maxColumn ?? lineWidth;
    let start = Math.max(0, minColumn);
    let end = Math.min(lineWidth, maxColumn);
    if (row === selection.start.row) {
      start =
        getGraphemeCellRange(line, selection.start.col)?.start ??
        Math.min(selection.start.col, lineWidth);
    }
    if (row === selection.end.row) {
      end =
        selection.end.boundary === true
          ? Math.min(selection.end.col, lineWidth)
          : (getGraphemeCellRange(line, selection.end.col)?.end ??
            Math.min(selection.end.col + 1, lineWidth));
    }
    return { end: Math.min(maxColumn, end), start: Math.max(minColumn, start) };
  },
);

const selectedText: {
  (
    sourceLines: readonly string[],
    selection: altScreenSelectionTextTypes.SelectionRange,
  ): string | undefined;
  (
    selection: altScreenSelectionTextTypes.SelectionRange,
  ): (sourceLines: readonly string[]) => string | undefined;
} = dual(
  2,
  (
    sourceLines: readonly string[],
    selection: altScreenSelectionTextTypes.SelectionRange,
  ): string | undefined => {
    const lines: string[] = [];
    for (let row = selection.start.row; row <= selection.end.row; row++) {
      const line = sourceLines[row] ?? "";
      const columns = selectionColumns(line, { row, selection });
      lines.push(
        stripTerminalSequences(
          sliceByColumn(line, columns.start, Math.max(0, columns.end - columns.start), true),
        ).trimEnd(),
      );
    }
    const text = lines.join("\n");
    return text.length === 0 ? undefined : text;
  },
);

function highlightSelectedText(text: string): string {
  let result = "\x1b[7m";
  let index = 0;
  while (index < text.length) {
    const ansi = extractAnsiCode(text, index);
    if (ansi === null) {
      result += text[index];
      index += 1;
      continue;
    }
    result += ansi.code;
    if (ansi.code.endsWith("m")) result += "\x1b[7m";
    index += ansi.length;
  }
  return `${result}\x1b[27m`;
}

const paintSelection: {
  (screen: readonly string[], paint: altScreenSelectionTextTypes.SelectionPaint): string[];
  (paint: altScreenSelectionTextTypes.SelectionPaint): (screen: readonly string[]) => string[];
} = dual(
  2,
  (screen: readonly string[], paint: altScreenSelectionTextTypes.SelectionPaint): string[] => {
    const { selection } = paint;
    return screen.map((line, row) => {
      if (
        row < paint.minRow ||
        row > paint.maxRow ||
        row < selection.start.row ||
        row > selection.end.row ||
        isImageLine(line)
      ) {
        return line;
      }
      const lineWidth = visibleWidth(line);
      const columns = selectionColumns(line, {
        maxColumn: paint.maxColumn,
        minColumn: paint.minColumn,
        row,
        selection,
      });
      if (columns.end <= columns.start) return line;
      const before = sliceByColumn(line, 0, columns.start, true);
      const selected = sliceByColumn(line, columns.start, columns.end - columns.start, true);
      const after = sliceByColumn(line, columns.end, Math.max(0, lineWidth - columns.end), true);
      return `${before}${highlightSelectedText(selected)}${after}`;
    });
  },
);

const altScreenSelectionText = {
  lineSelection,
  orderedSelection,
  paintSelection,
  selectedText,
  selectionColumns,
  visibleRows,
  wordSelection,
};

export default altScreenSelectionText;
