import { dual } from "effect/Function";

import type { AltScreenSearchMatch } from "./alt-screen-search.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { getScrollbarGeometry, type LayoutBox } from "./layout.ts";
import { isImageLine } from "./terminal-image-kitty.ts";
import { sliceByColumn } from "./text-slice.ts";
import { extractAnsiCode, visibleWidth } from "./utils.ts";

export type SearchSelectionMode = "query" | "retain" | "next" | "previous";

export interface SearchSelectionState {
  selectionMode: SearchSelectionMode;
  anchorRow: number;
  selectedIndex: number;
}

export interface SearchHighlightStyles {
  match: (text: string) => string;
  current: (text: string) => string;
}

export interface SearchHighlightRequest {
  matches: readonly AltScreenSearchMatch[];
  selectedIndex: number;
  box: LayoutBox;
  scrollView: ScrollView;
  columns: number;
  styles: SearchHighlightStyles;
}

interface SearchHighlightRange {
  startCol: number;
  endCol: number;
  current: boolean;
}

function firstRow(match: AltScreenSearchMatch): number {
  return match.segments[0]?.row ?? 0;
}

function lastRow(match: AltScreenSearchMatch): number {
  return match.segments[match.segments.length - 1]?.row ?? -1;
}

function lowerBound(
  matches: readonly AltScreenSearchMatch[],
  isBefore: (match: AltScreenSearchMatch) => boolean,
): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (isBefore(matches[middle]!)) low = middle + 1;
    else high = middle;
  }
  return low;
}

function steppedIndex(state: SearchSelectionState, count: number, exactIndex: number): number {
  const baseIndex = exactIndex >= 0 ? exactIndex : Math.min(state.selectedIndex, count - 1);
  if (state.selectionMode === "next") return baseIndex < 0 ? 0 : (baseIndex + 1) % count;
  return baseIndex < 0 ? count - 1 : (baseIndex - 1 + count) % count;
}

export const chooseSearchIndex: {
  (
    state: SearchSelectionState,
    matches: readonly AltScreenSearchMatch[],
    exactIndex: number,
  ): number;
  (
    matches: readonly AltScreenSearchMatch[],
    exactIndex: number,
  ): (state: SearchSelectionState) => number;
} = dual(
  3,
  (
    state: SearchSelectionState,
    matches: readonly AltScreenSearchMatch[],
    exactIndex: number,
  ): number => {
    if (matches.length === 0) return -1;
    switch (state.selectionMode) {
      case "query": {
        const low = lowerBound(matches, (match) => firstRow(match) < state.anchorRow);
        return low < matches.length ? low : 0;
      }
      case "next":
      case "previous":
        return steppedIndex(state, matches.length, exactIndex);
      default:
        return exactIndex >= 0
          ? exactIndex
          : Math.min(Math.max(0, state.selectedIndex), matches.length - 1);
    }
  },
);

function highlightSearchText(text: string, style: (text: string) => string): string {
  let result = "";
  let plainStart = 0;
  let index = 0;
  while (index < text.length) {
    const ansi = extractAnsiCode(text, index);
    if (ansi === null) {
      index += 1;
      continue;
    }
    if (index > plainStart) result += style(text.slice(plainStart, index));
    result += ansi.code;
    index += ansi.length;
    plainStart = index;
  }
  if (plainStart < text.length) result += style(text.slice(plainStart));
  return result;
}

function collectRanges(
  screenLength: number,
  request: SearchHighlightRequest,
): Map<number, SearchHighlightRange[]> {
  const { box, scrollView, matches } = request;
  const scrollbarColumn = getScrollbarGeometry(box)?.column;
  const minRow = Math.max(0, box.rect.y, box.clip.y);
  const maxRow = Math.min(screenLength, box.rect.y + box.rect.height, box.clip.y + box.clip.height);
  const minColumn = Math.max(0, box.rect.x, box.clip.x);
  const maxColumn = Math.min(
    request.columns,
    box.rect.x + box.rect.width,
    box.clip.x + box.clip.width,
    scrollbarColumn ?? Number.POSITIVE_INFINITY,
  );
  const minContentRow = scrollView.scrollTop + minRow - box.rect.y;
  const maxContentRow = scrollView.scrollTop + maxRow - box.rect.y - 1;
  const rangesByRow = new Map<number, SearchHighlightRange[]>();
  const start = lowerBound(matches, (match) => lastRow(match) < minContentRow);
  for (let matchIndex = start; matchIndex < matches.length; matchIndex++) {
    const match = matches[matchIndex]!;
    if (firstRow(match) > maxContentRow) break;
    for (const segment of match.segments) {
      const row = box.rect.y + segment.row - scrollView.scrollTop;
      if (row < minRow || row >= maxRow) continue;
      const startCol = Math.max(minColumn, box.rect.x + segment.startCol);
      const endCol = Math.min(maxColumn, box.rect.x + segment.endCol);
      if (endCol <= startCol) continue;
      const ranges = rangesByRow.get(row) ?? [];
      ranges.push({ startCol, endCol, current: matchIndex === request.selectedIndex });
      rangesByRow.set(row, ranges);
    }
  }
  return rangesByRow;
}

function paintRanges(
  line: string,
  ranges: SearchHighlightRange[],
  styles: SearchHighlightStyles,
): string {
  const lineWidth = visibleWidth(line);
  let result = line;
  for (const range of ranges.sort((a, b) => b.startCol - a.startCol)) {
    const startCol = Math.min(range.startCol, lineWidth);
    const endCol = Math.min(range.endCol, lineWidth);
    if (endCol <= startCol) continue;
    const before = sliceByColumn(result, 0, startCol, true);
    const highlighted = sliceByColumn(result, startCol, endCol - startCol, true);
    const after = sliceByColumn(result, endCol, Math.max(0, lineWidth - endCol), true);
    const style = range.current ? styles.current : styles.match;
    result = `${before}${highlightSearchText(highlighted, style)}${after}`;
  }
  return result;
}

export const highlightSearchMatches: {
  (screen: readonly string[], request: SearchHighlightRequest): string[];
  (request: SearchHighlightRequest): (screen: readonly string[]) => string[];
} = dual(2, (screen: readonly string[], request: SearchHighlightRequest): string[] => {
  const result = [...screen];
  for (const [row, ranges] of collectRanges(screen.length, request)) {
    const line = result[row] ?? "";
    if (isImageLine(line)) continue;
    result[row] = paintRanges(line, ranges, request.styles);
  }
  return result;
});
