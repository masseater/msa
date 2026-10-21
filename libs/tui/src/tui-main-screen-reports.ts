import { dual } from "effect/Function";

import type tuiMainScreenFrameTypes from "./tui-main-screen-frame.types.ts";
import type tuiMainScreenKittyTypes from "./tui-main-screen-kitty.types.ts";
import type tuiMainScreenReportsTypes from "./tui-main-screen-reports.types.ts";
import type tuiMainScreenSupportTypes from "./tui-main-screen-support.types.ts";
import utils from "./utils.ts";

const { visibleWidth } = utils;

const fullRenderReason: {
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    previous: tuiMainScreenReportsTypes.PreviousFrameState,
    policy: tuiMainScreenReportsTypes.FullRenderPolicy,
  ): tuiMainScreenReportsTypes.FullRenderDecision | undefined;
  (
    previous: tuiMainScreenReportsTypes.PreviousFrameState,
    policy: tuiMainScreenReportsTypes.FullRenderPolicy,
  ): (
    frame: tuiMainScreenFrameTypes.RenderFrame,
  ) => tuiMainScreenReportsTypes.FullRenderDecision | undefined;
} = dual(
  3,
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    previous: tuiMainScreenReportsTypes.PreviousFrameState,
    policy: tuiMainScreenReportsTypes.FullRenderPolicy,
  ): tuiMainScreenReportsTypes.FullRenderDecision | undefined => {
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

const overwideCrashLines: {
  (frame: tuiMainScreenFrameTypes.RenderFrame, index: number): string[];
  (index: number): (frame: tuiMainScreenFrameTypes.RenderFrame) => string[];
} = dual(2, (frame: tuiMainScreenFrameTypes.RenderFrame, index: number): string[] => [
  `Terminal width: ${frame.width}`,
  `Line ${index} visible width: ${visibleWidth(frame.newLines[index] ?? "")}`,
  "",
  "=== All rendered lines ===",
  ...frame.newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
  "",
]);

const overwideErrorMessage: {
  (frame: tuiMainScreenFrameTypes.RenderFrame, index: number, crashLogPath: string): string;
  (index: number, crashLogPath: string): (frame: tuiMainScreenFrameTypes.RenderFrame) => string;
} = dual(
  3,
  (frame: tuiMainScreenFrameTypes.RenderFrame, index: number, crashLogPath: string): string =>
    [
      `Rendered line ${index} exceeds terminal width (${visibleWidth(frame.newLines[index] ?? "")} > ${frame.width}).`,
      "",
      "This is likely caused by a custom TUI component not truncating its output.",
      "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
      "",
      `Debug log written to: ${crashLogPath}`,
    ].join("\n"),
);

const renderDebugLines: {
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
    values: tuiMainScreenReportsTypes.DebugRenderValues,
  ): string[];
  (
    range: tuiMainScreenKittyTypes.ChangedRange,
    values: tuiMainScreenReportsTypes.DebugRenderValues,
  ): (frame: tuiMainScreenFrameTypes.RenderFrame) => string[];
} = dual(
  3,
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
    values: tuiMainScreenReportsTypes.DebugRenderValues,
  ): string[] => [
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
  ],
);

const overwideCrash: {
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    index: number,
    directory: string | undefined,
  ): tuiMainScreenSupportTypes.RenderCrash;
  (
    index: number,
    directory: string | undefined,
  ): (frame: tuiMainScreenFrameTypes.RenderFrame) => tuiMainScreenSupportTypes.RenderCrash;
} = dual(
  3,
  (
    frame: tuiMainScreenFrameTypes.RenderFrame,
    index: number,
    directory: string | undefined,
  ): tuiMainScreenSupportTypes.RenderCrash => ({
    directory,
    lines: overwideCrashLines(frame, index),
    message: (crashLogPath) => overwideErrorMessage(frame, index, crashLogPath),
  }),
);

const tuiMainScreenReports = {
  fullRenderReason,
  overwideCrash,
  overwideCrashLines,
  overwideErrorMessage,
  renderDebugLines,
};

export default tuiMainScreenReports;
