import type TuiMainScreenClass from "./tui-main-screen.ts";

declare namespace tuiMainScreenTypes {
  interface TuiMainScreenRenderState {
    previousLines: string[];
    previousWidth: number;
    previousHeight: number;
    cursorRow: number;
    hardwareCursorRow: number;
    maxLinesRendered: number;
    previousViewportTop: number;
  }

  type TuiMainScreen = TuiMainScreenClass;
}

export type { tuiMainScreenTypes as default };
