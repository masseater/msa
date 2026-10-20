import { dual } from "effect/Function";

import type altScreenSearchResultsTypes from "./alt-screen-search-results.types.ts";
import type altScreenSearchTypes from "./alt-screen-search.types.ts";
import layout from "./layout.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import textSlice from "./text-slice.ts";
import utils from "./utils.ts";

const { extractAnsiCode, visibleWidth } = utils;
const { getScrollbarGeometry } = layout;
const { sliceByColumn } = textSlice;
const { isImageLine } = terminalImageKitty;

interface SearchHighlightRange {
  startCol: number;
  endCol: number;
  current: boolean;
}

function firstRow(match: altScreenSearchTypes.AltScreenSearchMatch): number {
  return match.segments[0]?.row ?? 0;
}

function lastRow(match: altScreenSearchTypes.AltScreenSearchMatch): number {
  return match.segments[match.segments.length - 1]?.row ?? -1;
}

function lowerBound(
  matches: readonly altScreenSearchTypes.AltScreenSearchMatch[],
  isBefore: (match: altScreenSearchTypes.AltScreenSearchMatch) => boolean,
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

function steppedIndex(
  state: altScreenSearchResultsTypes.SearchSelectionState,
  count: number,
  exactIndex: number,
): number {
  const baseIndex = exactIndex >= 0 ? exactIndex : Math.min(state.selectedIndex, count - 1);
  if (state.selectionMode === "next") return baseIndex < 0 ? 0 : (baseIndex + 1) % count;
  return baseIndex < 0 ? count - 1 : (baseIndex - 1 + count) % count;
}

const chooseSearchIndex: {
  (
    state: altScreenSearchResultsTypes.SearchSelectionState,
    matches: readonly altScreenSearchTypes.AltScreenSearchMatch[],
    exactIndex: number,
  ): number;
  (
    matches: readonly altScreenSearchTypes.AltScreenSearchMatch[],
    exactIndex: number,
  ): (state: altScreenSearchResultsTypes.SearchSelectionState) => number;
} = dual(
  3,
  (
    state: altScreenSearchResultsTypes.SearchSelectionState,
    matches: readonly altScreenSearchTypes.AltScreenSearchMatch[],
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
  request: altScreenSearchResultsTypes.SearchHighlightRequest,
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
      ranges.push({ current: matchIndex === request.selectedIndex, endCol, startCol });
      rangesByRow.set(row, ranges);
    }
  }
  return rangesByRow;
}

function paintRanges(
  line: string,
  ranges: SearchHighlightRange[],
  styles: altScreenSearchResultsTypes.SearchHighlightStyles,
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

const highlightSearchMatches: {
  (
    screen: readonly string[],
    request: altScreenSearchResultsTypes.SearchHighlightRequest,
  ): string[];
  (
    request: altScreenSearchResultsTypes.SearchHighlightRequest,
  ): (screen: readonly string[]) => string[];
} = dual(
  2,
  (
    screen: readonly string[],
    request: altScreenSearchResultsTypes.SearchHighlightRequest,
  ): string[] => {
    const result = [...screen];
    for (const [row, ranges] of collectRanges(screen.length, request)) {
      const line = result[row] ?? "";
      if (isImageLine(line)) continue;
      result[row] = paintRanges(line, ranges, request.styles);
    }
    return result;
  },
);

const altScreenSearchResults = {
  chooseSearchIndex,
  highlightSearchMatches,
};

export default altScreenSearchResults;
