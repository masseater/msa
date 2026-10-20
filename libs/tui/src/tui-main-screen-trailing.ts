import { dual } from "effect/Function";

import type tuiMainScreenFrameTypes from "./tui-main-screen-frame.types.ts";
import type tuiMainScreenSupportTypes from "./tui-main-screen-support.types.ts";

const appendTrailingClear: {
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
    previousLength: number,
    renderEnd: number,
  ): number;
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    previousLength: number,
    renderEnd: number,
  ): (output: tuiMainScreenSupportTypes.BoundedTerminalWriter) => number;
} = dual(
  4,
  (
    output: tuiMainScreenSupportTypes.BoundedTerminalWriter,
    frame: tuiMainScreenFrameTypes.RenderFrame,
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

const tuiMainScreenTrailing = {
  appendTrailingClear,
};

export default tuiMainScreenTrailing;
