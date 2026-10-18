import { dual } from "effect/Function";

import { isImageLine } from "./terminal-image-kitty.ts";
import {
  type ChangedRange,
  deleteChangedKittyImages,
  getKittyImageReservedRows,
} from "./tui-main-screen-kitty.ts";
import type { BoundedTerminalWriter } from "./tui-main-screen-support.ts";
import { visibleWidth } from "./utils.ts";

export type CursorPosition = { row: number; col: number };

export interface RenderFrame {
  readonly width: number;
  readonly height: number;
  readonly newLines: string[];
  readonly cursorPos: CursorPosition | null;
  prevViewportTop: number;
  viewportTop: number;
  hardwareCursorRow: number;
}

export interface CursorMove {
  row: number;
  sequence: string;
}

export type FrameOutcome =
  | { kind: "fallback"; reason: string }
  | { kind: "overwide"; index: number }
  | { kind: "done"; row: number };

export const lineDiffTo: {
  (frame: RenderFrame, targetRow: number): number;
  (targetRow: number): (frame: RenderFrame) => number;
} = dual(2, (frame: RenderFrame, targetRow: number): number => {
  const currentScreenRow = frame.hardwareCursorRow - frame.prevViewportTop;
  const targetScreenRow = targetRow - frame.viewportTop;
  return targetScreenRow - currentScreenRow;
});

export function cursorMove(lineDiff: number): string {
  if (lineDiff > 0) return `\x1b[${lineDiff}B`;
  if (lineDiff < 0) return `\x1b[${-lineDiff}A`;
  return "";
}

export const hardwareCursorMove: {
  (currentRow: number, cursorPos: CursorPosition, totalLines: number): CursorMove;
  (cursorPos: CursorPosition, totalLines: number): (currentRow: number) => CursorMove;
} = dual(3, (currentRow: number, cursorPos: CursorPosition, totalLines: number): CursorMove => {
  const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
  const targetCol = Math.max(0, cursorPos.col);
  return {
    row: targetRow,
    sequence: `${cursorMove(targetRow - currentRow)}\x1b[${targetCol + 1}G`,
  };
});

function appendClearedRows(
  output: BoundedTerminalWriter,
  extraLines: number,
  clearStartOffset: number,
): void {
  if (extraLines > 0 && clearStartOffset > 0) {
    output.append(`\x1b[${clearStartOffset}B`);
  }
  for (let i = 0; i < extraLines; i++) {
    output.append("\r\x1b[2K");
    if (i < extraLines - 1) output.append("\x1b[1B");
  }
  const moveBack = Math.max(0, extraLines - 1 + clearStartOffset);
  if (moveBack > 0) {
    output.append(`\x1b[${moveBack}A`);
  }
}

export const appendFullRenderLines: {
  (output: BoundedTerminalWriter, frame: RenderFrame): void;
  (frame: RenderFrame): (output: BoundedTerminalWriter) => void;
} = dual(2, (output: BoundedTerminalWriter, frame: RenderFrame): void => {
  const { newLines, height } = frame;
  for (let i = 0; i < newLines.length; i++) {
    if (i > 0) output.append("\r\n");
    const line = newLines[i];
    if (line === undefined) break;
    const imageReservedRows = isImageLine(line) ? getKittyImageReservedRows(newLines, i) : 1;
    if (imageReservedRows > 1 && imageReservedRows <= height) {
      output.append("\r\n".repeat(imageReservedRows - 1));
      output.append(`\x1b[${imageReservedRows - 1}A`);
      output.append(line);
      output.append(`\x1b[${imageReservedRows - 1}B`);
      i += imageReservedRows - 1;
      continue;
    }
    output.append(line);
  }
});

export const clearDeletedTail: {
  (
    output: BoundedTerminalWriter,
    frame: RenderFrame,
    previousLines: readonly string[],
    range: ChangedRange,
  ): FrameOutcome;
  (
    frame: RenderFrame,
    previousLines: readonly string[],
    range: ChangedRange,
  ): (output: BoundedTerminalWriter) => FrameOutcome;
} = dual(
  4,
  (
    output: BoundedTerminalWriter,
    frame: RenderFrame,
    previousLines: readonly string[],
    range: ChangedRange,
  ): FrameOutcome => {
    const { newLines, height } = frame;
    output.append("\x1b[?2026h");
    output.append(deleteChangedKittyImages(previousLines, range));
    const targetRow = Math.max(0, newLines.length - 1);
    if (targetRow < frame.prevViewportTop) {
      return {
        kind: "fallback",
        reason: `deleted lines moved viewport up (${targetRow} < ${frame.prevViewportTop})`,
      };
    }
    output.append(cursorMove(lineDiffTo(frame, targetRow)));
    output.append("\r");
    const extraLines = previousLines.length - newLines.length;
    if (extraLines > height) {
      return { kind: "fallback", reason: `extraLines > height (${extraLines} > ${height})` };
    }
    appendClearedRows(output, extraLines, newLines.length === 0 ? 0 : 1);
    output.append("\x1b[?2026l");
    return { kind: "done", row: targetRow };
  },
);

export const moveToFirstChanged: {
  (output: BoundedTerminalWriter, frame: RenderFrame, range: ChangedRange): number;
  (frame: RenderFrame, range: ChangedRange): (output: BoundedTerminalWriter) => number;
} = dual(3, (output: BoundedTerminalWriter, frame: RenderFrame, range: ChangedRange): number => {
  const { height } = frame;
  const prevViewportBottom = frame.prevViewportTop + height - 1;
  const moveTargetRow = range.appendStart ? range.firstChanged - 1 : range.firstChanged;
  if (moveTargetRow > prevViewportBottom) {
    const currentScreenRow = Math.max(
      0,
      Math.min(height - 1, frame.hardwareCursorRow - frame.prevViewportTop),
    );
    const moveToBottom = height - 1 - currentScreenRow;
    if (moveToBottom > 0) {
      output.append(`\x1b[${moveToBottom}B`);
    }
    const scroll = moveTargetRow - prevViewportBottom;
    output.append("\r\n".repeat(scroll));
    frame.prevViewportTop += scroll;
    frame.viewportTop += scroll;
    frame.hardwareCursorRow = moveTargetRow;
  }

  const lineDiff = lineDiffTo(frame, moveTargetRow);
  output.append(cursorMove(lineDiff));
  output.append(range.appendStart ? "\r\n" : "\r");
  return lineDiff;
});

function appendChangedImage(
  output: BoundedTerminalWriter,
  frame: RenderFrame,
  index: number,
  reservedRows: number,
): FrameOutcome {
  const imageStartScreenRow = index - frame.viewportTop;
  if (imageStartScreenRow < 0 || imageStartScreenRow + reservedRows > frame.height) {
    return {
      kind: "fallback",
      reason: `kitty image pre-clear would scroll (${imageStartScreenRow} + ${reservedRows} > ${frame.height})`,
    };
  }
  output.append("\x1b[2K");
  output.append("\r\n\x1b[2K".repeat(reservedRows - 1));
  output.append(`\x1b[${reservedRows - 1}A`);
  output.append(frame.newLines[index] ?? "");
  output.append(`\x1b[${reservedRows - 1}B`);
  return { kind: "done", row: index + reservedRows - 1 };
}

export const appendChangedLines: {
  (
    output: BoundedTerminalWriter,
    frame: RenderFrame,
    range: ChangedRange,
    renderEnd: number,
  ): FrameOutcome;
  (
    frame: RenderFrame,
    range: ChangedRange,
    renderEnd: number,
  ): (output: BoundedTerminalWriter) => FrameOutcome;
} = dual(
  4,
  (
    output: BoundedTerminalWriter,
    frame: RenderFrame,
    range: ChangedRange,
    renderEnd: number,
  ): FrameOutcome => {
    const { newLines } = frame;
    for (let i = range.firstChanged; i <= renderEnd; i++) {
      if (i > range.firstChanged) output.append("\r\n");
      const line = newLines[i];
      if (line === undefined) break;
      const isImage = isImageLine(line);
      const reservedRows = isImage ? getKittyImageReservedRows(newLines, i, renderEnd) : 1;
      if (reservedRows > 1) {
        const outcome = appendChangedImage(output, frame, i, reservedRows);
        if (outcome.kind !== "done") return outcome;
        i = outcome.row;
        continue;
      }
      output.append("\x1b[2K");
      if (!isImage && visibleWidth(line) > frame.width) return { kind: "overwide", index: i };
      output.append(line);
    }
    return { kind: "done", row: renderEnd };
  },
);

export const appendTrailingClear: {
  (
    output: BoundedTerminalWriter,
    frame: RenderFrame,
    previousLength: number,
    renderEnd: number,
  ): number;
  (
    frame: RenderFrame,
    previousLength: number,
    renderEnd: number,
  ): (output: BoundedTerminalWriter) => number;
} = dual(
  4,
  (
    output: BoundedTerminalWriter,
    frame: RenderFrame,
    previousLength: number,
    renderEnd: number,
  ): number => {
    const { newLines } = frame;
    if (previousLength <= newLines.length) return renderEnd;
    let finalCursorRow = renderEnd;
    if (renderEnd < newLines.length - 1) {
      output.append(`\x1b[${newLines.length - 1 - renderEnd}B`);
      finalCursorRow = newLines.length - 1;
    }
    const extraLines = previousLength - newLines.length;
    output.append("\r\n\x1b[2K".repeat(extraLines));
    output.append(`\x1b[${extraLines}A`);
    return finalCursorRow;
  },
);
