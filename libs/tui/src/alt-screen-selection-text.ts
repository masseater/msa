import { dual } from "effect/Function";

import type { ScrollView } from "./components/scroll-view.ts";
import type { LayoutBox } from "./layout.ts";
import { isImageLine } from "./terminal-image-kitty.ts";
import { getGraphemeCellRange, sliceByColumn } from "./text-slice.ts";
import {
  extractAnsiCode,
  getWordSegmenter,
  stripTerminalSequences,
  visibleWidth,
} from "./utils.ts";

const TERMINAL_WORD_SELECTION_JOINERS = new Set(["/", "-"]);
const wordSegmenter = getWordSegmenter();

export interface SelectionPoint {
  row: number;
  col: number;
  scrollView?: ScrollView;
  boundary?: boolean;
}

export interface SelectionRange {
  start: SelectionPoint;
  end: SelectionPoint;
}

export interface SelectionWindow {
  row: number;
  selection: SelectionRange;
  minColumn?: number;
  maxColumn?: number;
}

export interface SelectionPaint {
  selection: SelectionRange;
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
}

export interface VisibleRows {
  top: number;
  bottom: number;
}

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
    segments.push({ start, end, selectable: segment.isWordLike === true || joiner, joiner });
    start = end;
  }
  return segments;
}

function canJoin(left: WordSegment, right: WordSegment): boolean {
  return left.selectable && right.selectable && (left.joiner || right.joiner);
}

export const visibleRows: {
  (box: LayoutBox | undefined, terminalRows: number): VisibleRows | undefined;
  (terminalRows: number): (box: LayoutBox | undefined) => VisibleRows | undefined;
} = dual(2, (box: LayoutBox | undefined, terminalRows: number): VisibleRows | undefined => {
  if (box === undefined || box.rect.height <= 0 || box.clip.height <= 0) return undefined;
  return {
    top: Math.max(0, box.rect.y, box.clip.y),
    bottom: Math.min(
      terminalRows - 1,
      box.rect.y + box.rect.height - 1,
      box.clip.y + box.clip.height - 1,
    ),
  };
});

export const wordSelection: {
  (line: string, point: SelectionPoint): SelectionRange | undefined;
  (point: SelectionPoint): (line: string) => SelectionRange | undefined;
} = dual(2, (line: string, point: SelectionPoint): SelectionRange | undefined => {
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
    start: { ...point, col: selectionStart },
    end: { ...point, col: selectionEnd, boundary: true },
  };
});

export const lineSelection: {
  (line: string, point: SelectionPoint): SelectionRange;
  (point: SelectionPoint): (line: string) => SelectionRange;
} = dual(2, (line: string, point: SelectionPoint): SelectionRange => ({
  start: { ...point, col: 0 },
  end: { ...point, col: visibleWidth(line), boundary: true },
}));

export const orderedSelection: {
  (anchor: SelectionPoint, focus: SelectionPoint): SelectionRange | undefined;
  (focus: SelectionPoint): (anchor: SelectionPoint) => SelectionRange | undefined;
} = dual(2, (anchor: SelectionPoint, focus: SelectionPoint): SelectionRange | undefined => {
  if (anchor.scrollView !== focus.scrollView) return undefined;
  if (anchor.row === focus.row && anchor.col === focus.col) return undefined;
  const anchorBeforeFocus =
    anchor.row < focus.row || (anchor.row === focus.row && anchor.col < focus.col);
  return anchorBeforeFocus ? { start: anchor, end: focus } : { start: focus, end: anchor };
});

export const selectionColumns: {
  (line: string, window: SelectionWindow): { start: number; end: number };
  (window: SelectionWindow): (line: string) => { start: number; end: number };
} = dual(2, (line: string, window: SelectionWindow): { start: number; end: number } => {
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
  return { start: Math.max(minColumn, start), end: Math.min(maxColumn, end) };
});

export const selectedText: {
  (sourceLines: readonly string[], selection: SelectionRange): string | undefined;
  (selection: SelectionRange): (sourceLines: readonly string[]) => string | undefined;
} = dual(2, (sourceLines: readonly string[], selection: SelectionRange): string | undefined => {
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
});

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

export const paintSelection: {
  (screen: readonly string[], paint: SelectionPaint): string[];
  (paint: SelectionPaint): (screen: readonly string[]) => string[];
} = dual(2, (screen: readonly string[], paint: SelectionPaint): string[] => {
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
      row,
      selection,
      minColumn: paint.minColumn,
      maxColumn: paint.maxColumn,
    });
    if (columns.end <= columns.start) return line;
    const before = sliceByColumn(line, 0, columns.start, true);
    const selected = sliceByColumn(line, columns.start, columns.end - columns.start, true);
    const after = sliceByColumn(line, columns.end, Math.max(0, lineWidth - columns.end), true);
    return `${before}${highlightSelectedText(selected)}${after}`;
  });
});
