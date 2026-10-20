import { dual } from "effect/Function";

import terminalImageKitty from "./terminal-image-kitty.ts";
import tuiComponent from "./tui-component.ts";
import type tuiFrameLinesTypes from "./tui-frame-lines.types.ts";
import utils from "./utils.ts";

const { isImageLine } = terminalImageKitty;
const { normalizeTerminalOutput, visibleWidth } = utils;
const {
  CURSOR_MARKER,
  FAKE_CURSOR_END,
  FAKE_CURSOR_START,
  SEGMENT_RESET,
  unwrapFocusedFakeCursor,
} = tuiComponent;

function applyLineResets(lines: string[]): string[] {
  for (const [i, line] of lines.entries()) {
    if (!isImageLine(line)) {
      lines[i] = normalizeTerminalOutput(line) + SEGMENT_RESET;
    }
  }
  return lines;
}

const extractCursorPosition: {
  (lines: string[], height: number): tuiFrameLinesTypes.CursorPosition | null;
  (height: number): (lines: string[]) => tuiFrameLinesTypes.CursorPosition | null;
} = dual(2, (lines: string[], height: number): tuiFrameLinesTypes.CursorPosition | null => {
  const viewportTop = Math.max(0, lines.length - height);
  for (let row = lines.length - 1; row >= viewportTop; row--) {
    const line = lines[row];
    if (line === undefined) continue;
    const markerIndex = line.indexOf(CURSOR_MARKER);
    if (markerIndex !== -1) {
      const beforeMarker = line.slice(0, markerIndex);
      const col = visibleWidth(beforeMarker);

      lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);

      return { col, row };
    }
  }
  return null;
});

const resolveFakeCursors: {
  (lines: string[], showHardwareCursor: boolean): string[];
  (showHardwareCursor: boolean): (lines: string[]) => string[];
} = dual(2, (lines: string[], showHardwareCursor: boolean): string[] =>
  lines.map((line) => {
    if (!line.includes(FAKE_CURSOR_START)) return line;
    const resolved = showHardwareCursor ? unwrapFocusedFakeCursor(line) : line;
    return resolved
      .replaceAll(FAKE_CURSOR_START, "\x1b[7m")
      .replaceAll(FAKE_CURSOR_END, "\x1b[27m");
  }),
);

const tuiFrameLines = {
  applyLineResets,
  extractCursorPosition,
  resolveFakeCursors,
};

export default tuiFrameLines;
