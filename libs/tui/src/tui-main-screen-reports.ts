import { dual } from "effect/Function";

import type { RenderFrame } from "./tui-main-screen-frame.ts";
import type { ChangedRange } from "./tui-main-screen-kitty.ts";
import type { RenderCrash } from "./tui-main-screen-support.ts";
import { visibleWidth } from "./utils.ts";

export interface PreviousFrameState {
  lineCount: number;
  width: number;
  height: number;
  maxLinesRendered: number;
}

export interface FullRenderPolicy {
  clearOnShrink: boolean;
  hasOverlays: boolean;
  termux: boolean;
}

export interface FullRenderDecision {
  clear: boolean;
  message: string;
}

export interface DebugRenderValues {
  lineDiff: number;
  renderEnd: number;
  finalCursorRow: number;
  written: number;
  cursorRow: number;
  previousLines: readonly string[];
}

export const fullRenderReason: {
  (
    frame: RenderFrame,
    previous: PreviousFrameState,
    policy: FullRenderPolicy,
  ): FullRenderDecision | undefined;
  (
    previous: PreviousFrameState,
    policy: FullRenderPolicy,
  ): (frame: RenderFrame) => FullRenderDecision | undefined;
} = dual(
  3,
  (
    frame: RenderFrame,
    previous: PreviousFrameState,
    policy: FullRenderPolicy,
  ): FullRenderDecision | undefined => {
    const widthChanged = previous.width !== 0 && previous.width !== frame.width;
    const heightChanged = previous.height !== 0 && previous.height !== frame.height;
    if (previous.lineCount === 0 && !widthChanged && !heightChanged) {
      return { clear: false, message: "first render" };
    }
    if (widthChanged) {
      return {
        clear: true,
        message: `terminal width changed (${previous.width} -> ${frame.width})`,
      };
    }
    if (heightChanged && !policy.termux) {
      return {
        clear: true,
        message: `terminal height changed (${previous.height} -> ${frame.height})`,
      };
    }
    if (
      policy.clearOnShrink &&
      frame.newLines.length < previous.maxLinesRendered &&
      !policy.hasOverlays
    ) {
      return {
        clear: true,
        message: `clearOnShrink (maxLinesRendered=${previous.maxLinesRendered})`,
      };
    }
    return undefined;
  },
);

export const overwideCrashLines: {
  (frame: RenderFrame, index: number): string[];
  (index: number): (frame: RenderFrame) => string[];
} = dual(2, (frame: RenderFrame, index: number): string[] => [
  `Terminal width: ${frame.width}`,
  `Line ${index} visible width: ${visibleWidth(frame.newLines[index] ?? "")}`,
  "",
  "=== All rendered lines ===",
  ...frame.newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
  "",
]);

export const overwideErrorMessage: {
  (frame: RenderFrame, index: number, crashLogPath: string): string;
  (index: number, crashLogPath: string): (frame: RenderFrame) => string;
} = dual(3, (frame: RenderFrame, index: number, crashLogPath: string): string =>
  [
    `Rendered line ${index} exceeds terminal width (${visibleWidth(frame.newLines[index] ?? "")} > ${frame.width}).`,
    "",
    "This is likely caused by a custom TUI component not truncating its output.",
    "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
    "",
    `Debug log written to: ${crashLogPath}`,
  ].join("\n"),
);

export const renderDebugLines: {
  (frame: RenderFrame, range: ChangedRange, values: DebugRenderValues): string[];
  (range: ChangedRange, values: DebugRenderValues): (frame: RenderFrame) => string[];
} = dual(3, (frame: RenderFrame, range: ChangedRange, values: DebugRenderValues): string[] => [
  `firstChanged: ${range.firstChanged}`,
  `viewportTop: ${frame.viewportTop}`,
  `cursorRow: ${values.cursorRow}`,
  `height: ${frame.height}`,
  `lineDiff: ${values.lineDiff}`,
  `hardwareCursorRow: ${frame.hardwareCursorRow}`,
  `renderEnd: ${values.renderEnd}`,
  `finalCursorRow: ${values.finalCursorRow}`,
  `cursorPos: ${JSON.stringify(frame.cursorPos)}`,
  `newLines.length: ${frame.newLines.length}`,
  `previousLines.length: ${values.previousLines.length}`,
  "",
  "=== newLines ===",
  JSON.stringify(frame.newLines, null, 2),
  "",
  "=== previousLines ===",
  JSON.stringify(values.previousLines, null, 2),
  "",
  "=== buffer ===",
  `[${values.written} chars written in bounded chunks]`,
]);

export const overwideCrash: {
  (frame: RenderFrame, index: number, directory: string | undefined): RenderCrash;
  (index: number, directory: string | undefined): (frame: RenderFrame) => RenderCrash;
} = dual(3, (frame: RenderFrame, index: number, directory: string | undefined): RenderCrash => ({
  directory,
  lines: overwideCrashLines(frame, index),
  message: (crashLogPath) => overwideErrorMessage(frame, index, crashLogPath),
}));
