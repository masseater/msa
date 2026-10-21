declare namespace editorWrapTypes {
  interface TextChunk {
    text: string;
    startIndex: number;
    endIndex: number;
  }

  interface VisualLine {
    logicalLine: number;
    startCol: number;
    length: number;
  }

  interface LayoutLine {
    text: string;
    hasCursor: boolean;
    cursorPos?: number;
  }

  interface WrappableText {
    readonly lines: readonly string[];
    readonly cursorLine: number;
    readonly cursorCol: number;
    graphemes(text: string): Intl.SegmentData[];
  }
}

export type { editorWrapTypes as default };
