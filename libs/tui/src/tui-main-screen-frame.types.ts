declare namespace tuiMainScreenFrameTypes {
  type CursorPosition = { row: number; col: number };

  interface RenderFrame {
    readonly width: number;
    readonly height: number;
    readonly newLines: string[];
    readonly cursorPos: CursorPosition | null;
    prevViewportTop: number;
    viewportTop: number;
    hardwareCursorRow: number;
  }

  interface CursorMove {
    row: number;
    sequence: string;
  }

  type FrameOutcome =
    | { kind: "fallback"; reason: string }
    | { kind: "overwide"; index: number }
    | { kind: "done"; row: number };
}

export type { tuiMainScreenFrameTypes as default };
