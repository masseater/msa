import { dual } from "effect/Function";

import terminalImageKitty from "./terminal-image-kitty.ts";
import type tuiMainScreenKittyTypes from "./tui-main-screen-kitty.types.ts";
import tuiMainScreenSupport from "./tui-main-screen-support.ts";
import utils from "./utils.ts";

const { extractKittyImageIds, extractKittyImageRows } = tuiMainScreenSupport;
const { deleteKittyImage, isImageLine } = terminalImageKitty;
const { visibleWidth } = utils;

function collectKittyImageIds(lines: readonly string[]): Set<number> {
  const ids = new Set<number>();
  for (const line of lines) {
    for (const id of extractKittyImageIds(line)) {
      ids.add(id);
    }
  }
  return ids;
}

function deleteKittyImages(ids: Iterable<number>): string {
  let buffer = "";
  for (const id of ids) {
    buffer += deleteKittyImage(id);
  }
  return buffer;
}

const getKittyImageReservedRows: {
  (lines: readonly string[], index: number, maxIndex?: number): number;
  (index: number, maxIndex?: number): (lines: readonly string[]) => number;
} = dual(
  (args) => Array.isArray(args[0]),
  (lines: readonly string[], index: number, maxIndex = lines.length - 1): number => {
    const rows = extractKittyImageRows(lines[index] ?? "");
    if (rows <= 1) return 1;

    const maxRows = Math.min(rows, maxIndex - index + 1, lines.length - index);
    let reservedRows = 1;
    while (reservedRows < maxRows) {
      const line = lines[index + reservedRows] ?? "";
      if (isImageLine(line) || visibleWidth(line) > 0) break;
      reservedRows++;
    }
    return reservedRows;
  },
);

function expandForLines(
  lines: readonly string[],
  original: tuiMainScreenKittyTypes.LineRange,
  expanded: tuiMainScreenKittyTypes.LineRange,
): void {
  for (const [i, line] of lines.entries()) {
    if (extractKittyImageIds(line).length === 0) continue;
    const blockEnd = i + getKittyImageReservedRows(lines, i) - 1;
    if (
      i >= original.firstChanged ||
      (i <= original.lastChanged && blockEnd >= original.firstChanged)
    ) {
      expanded.firstChanged = Math.min(expanded.firstChanged, i);
      expanded.lastChanged = Math.max(expanded.lastChanged, blockEnd);
    }
  }
}

const expandChangedRangeForKittyImages: {
  (
    previousLines: readonly string[],
    newLines: readonly string[],
    range: tuiMainScreenKittyTypes.LineRange,
  ): tuiMainScreenKittyTypes.LineRange;
  (
    newLines: readonly string[],
    range: tuiMainScreenKittyTypes.LineRange,
  ): (previousLines: readonly string[]) => tuiMainScreenKittyTypes.LineRange;
} = dual(
  3,
  (
    previousLines: readonly string[],
    newLines: readonly string[],
    range: tuiMainScreenKittyTypes.LineRange,
  ): tuiMainScreenKittyTypes.LineRange => {
    const expanded = { ...range };
    expandForLines(previousLines, range, expanded);
    expandForLines(newLines, range, expanded);
    return expanded;
  },
);

const deleteChangedKittyImages: {
  (previousLines: readonly string[], range: tuiMainScreenKittyTypes.LineRange): string;
  (range: tuiMainScreenKittyTypes.LineRange): (previousLines: readonly string[]) => string;
} = dual(
  2,
  (previousLines: readonly string[], range: tuiMainScreenKittyTypes.LineRange): string => {
    const { firstChanged, lastChanged } = range;
    if (firstChanged < 0 || lastChanged < firstChanged) return "";

    const ids = new Set<number>();
    const maxLine = Math.min(lastChanged, previousLines.length - 1);
    for (let i = firstChanged; i <= maxLine; i++) {
      for (const id of extractKittyImageIds(previousLines[i] ?? "")) {
        ids.add(id);
      }
    }
    return deleteKittyImages(ids);
  },
);

const changedRange: {
  (
    previousLines: readonly string[],
    newLines: readonly string[],
  ): tuiMainScreenKittyTypes.ChangedRange | undefined;
  (
    newLines: readonly string[],
  ): (previousLines: readonly string[]) => tuiMainScreenKittyTypes.ChangedRange | undefined;
} = dual(
  2,
  (
    previousLines: readonly string[],
    newLines: readonly string[],
  ): tuiMainScreenKittyTypes.ChangedRange | undefined => {
    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, previousLines.length);
    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < previousLines.length ? previousLines[i] : "";
      const newLine = i < newLines.length ? newLines[i] : "";
      if (oldLine !== newLine) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }
    const appendedLines = newLines.length > previousLines.length;
    if (appendedLines) {
      if (firstChanged === -1) firstChanged = previousLines.length;
      lastChanged = newLines.length - 1;
    }
    if (firstChanged === -1) return undefined;
    const expanded = expandChangedRangeForKittyImages(previousLines, newLines, {
      firstChanged,
      lastChanged,
    });
    const appendStart =
      appendedLines && expanded.firstChanged === previousLines.length && expanded.firstChanged > 0;
    return { ...expanded, appendStart };
  },
);

const tuiMainScreenKitty = {
  changedRange,
  collectKittyImageIds,
  deleteChangedKittyImages,
  deleteKittyImages,
  expandChangedRangeForKittyImages,
  getKittyImageReservedRows,
};

export default tuiMainScreenKitty;
