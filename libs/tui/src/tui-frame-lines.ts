import { dual } from "effect/Function";

import { isImageLine } from "./terminal-image-kitty.ts";
import {
  CURSOR_MARKER,
  FAKE_CURSOR_END,
  FAKE_CURSOR_START,
  SEGMENT_RESET,
  unwrapFocusedFakeCursor,
} from "./tui-component.ts";
import { normalizeTerminalOutput, visibleWidth } from "./utils.ts";

export interface CursorPosition {
  row: number;
  col: number;
}

export function applyLineResets(lines: string[]): string[] {
  for (const [i, line] of lines.entries()) {
    if (!isImageLine(line)) {
      lines[i] = normalizeTerminalOutput(line) + SEGMENT_RESET;
    }
  }
  return lines;
}

export const extractCursorPosition: {
  (lines: string[], height: number): CursorPosition | null;
  (height: number): (lines: string[]) => CursorPosition | null;
} = dual(2, (lines: string[], height: number): CursorPosition | null => {
  const viewportTop = Math.max(0, lines.length - height);
  for (let row = lines.length - 1; row >= viewportTop; row--) {
    const line = lines[row];
    if (line === undefined) continue;
    const markerIndex = line.indexOf(CURSOR_MARKER);
    if (markerIndex !== -1) {
      const beforeMarker = line.slice(0, markerIndex);
      const col = visibleWidth(beforeMarker);

      lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);

      return { row, col };
    }
  }
  return null;
});

export const resolveFakeCursors: {
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
