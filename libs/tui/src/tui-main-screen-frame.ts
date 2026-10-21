import { dual } from "effect/Function";

import terminalImageKitty from "./terminal-image-kitty.ts";
import type tuiMainScreenFrameTypes from "./tui-main-screen-frame.types.ts";
import tuiMainScreenKitty from "./tui-main-screen-kitty.ts";
import type tuiMainScreenKittyTypes from "./tui-main-screen-kitty.types.ts";
import type tuiMainScreenSupportTypes from "./tui-main-screen-support.types.ts";
import tuiMainScreenTrailing from "./tui-main-screen-trailing.ts";
import utils from "./utils.ts";

const { appendTrailingClear } = tuiMainScreenTrailing;

const { isImageLine } = terminalImageKitty;
const { deleteChangedKittyImages, getKittyImageReservedRows } = tuiMainScreenKitty;
const { visibleWidth } = utils;

const lineDiffTo: {
  (frame: tuiMainScreenFrameTypes.RenderFrame, targetRow: number): number;
  (targetRow: number): (frame: tuiMainScreenFrameTypes.RenderFrame) => number;
} = dual(2, (frame: tuiMainScreenFrameTypes.RenderFrame, targetRow: number): number => {
  const currentScreenRow = frame.hardwareCursorRow - frame.prevViewportTop;
  const targetScreenRow = targetRow - frame.viewportTop;
  return targetScreenRow - currentScreenRow;
});

function cursorMove(lineDiff: number): string {
  if (lineDiff > 0) return `\x1b[${lineDiff}B`;
  if (lineDiff < 0) return `\x1b[${-lineDiff}A`;
  return "";
}

const hardwareCursorMove: {
  (
    currentRow: number,
    cursorPos: tuiMainScreenFrameTypes.CursorPosition,
    totalLines: number,
  ): tuiMainScreenFrameTypes.CursorMove;
  (
    cursorPos: tuiMainScreenFrameTypes.CursorPosition,
    totalLines: number,
  ): (currentRow: number) => tuiMainScreenFrameTypes.CursorMove;
} = dual(
  3,
  (
    currentRow: number,
    cursorPos: tuiMainScreenFrameTypes.CursorPosition,
    totalLines: number,
  ): tuiMainScreenFrameTypes.CursorMove => {
    const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
    const targetCol = Math.max(0, cursorPos.col);
    return {
      row: targetRow,
      sequence: `${cursorMove(targetRow - currentRow)}\x1b[${targetCol + 1}G`,
    };
  },
);

function appendClearedRows(
  output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
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

const appendFullRenderLines: {
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
  ): void;
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
  ): (output: tuiMainScreenSupportTypes.BoundedTerminalWriter) => void;
} = dual(
  2,
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
  ): void => {
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
  },
);

const clearDeletedTail: {
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
    previousLines: readonly string[],
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): tuiMainScreenFrameTypes.FrameOutcome;
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    previousLines: readonly string[],
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
  ) => tuiMainScreenFrameTypes.FrameOutcome;
} = dual(
  4,
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
    previousLines: readonly string[],
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): tuiMainScreenFrameTypes.FrameOutcome => {
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

const moveToFirstChanged: {
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): number;
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): (output: tuiMainScreenSupportTypes.BoundedTerminalWriter) => number;
} = dual(
  3,
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): number => {
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
  },
);

function appendChangedImage(
  output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
  frame: tuiMainScreenFrameTypes.RenderFrame,
  index: number,
  reservedRows: number,
): tuiMainScreenFrameTypes.FrameOutcome {
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

const appendChangedLines: {
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
    renderEnd: number,
  ): tuiMainScreenFrameTypes.FrameOutcome;
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
    renderEnd: number,
  ): (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
  ) => tuiMainScreenFrameTypes.FrameOutcome;
} = dual(
  4,
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
    renderEnd: number,
  ): tuiMainScreenFrameTypes.FrameOutcome => {
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
      if (!isImage && visibleWidth(line) > frame.width) return { index: i, kind: "overwide" };
      output.append(line);
    }
    return { kind: "done", row: renderEnd };
  },
);

const tuiMainScreenFrame = {
  appendChangedLines,
  appendFullRenderLines,
  appendTrailingClear,
  clearDeletedTail,
  cursorMove,
  hardwareCursorMove,
  lineDiffTo,
  moveToFirstChanged,
};

export default tuiMainScreenFrame;
