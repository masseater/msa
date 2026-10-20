declare namespace tuiMainScreenReportsTypes {
  interface PreviousFrameState {
    lineCount: number;
    width: number;
    height: number;
    maxLinesRendered: number;
  }

  interface FullRenderPolicy {
    clearOnShrink: boolean;
    hasOverlays: boolean;
    termux: boolean;
  }

  interface FullRenderDecision {
    clear: boolean;
    message: string;
  }

  interface DebugRenderValues {
    lineDiff: number;
    renderEnd: number;
    finalCursorRow: number;
    written: number;
    cursorRow: number;
    previousLines: readonly string[];
  }
}

export type { tuiMainScreenReportsTypes as default };
