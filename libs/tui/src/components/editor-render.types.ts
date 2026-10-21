import type editorWrapTypes from "./editor-wrap.types.ts";

declare namespace editorRenderTypes {
  interface EditorPadding {
    paddingX: number;
    contentWidth: number;
  }

  interface EditorContentFrame extends EditorPadding {
    focused: boolean;
    graphemes: (text: string) => Intl.SegmentData[];
  }

  interface ScrollWindow {
    layoutLines: readonly editorWrapTypes.LayoutLine[];
    scrollOffset: number;
    maxVisibleLines: number;
  }
}

export type { editorRenderTypes as default };
