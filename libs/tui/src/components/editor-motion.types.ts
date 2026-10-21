import type EditorMotionClass from "./editor-motion.ts";

declare namespace editorMotionTypes {
  interface CursorTarget {
    line: number;
    col: number;
  }

  type EditorMotion = EditorMotionClass;
}

export type { editorMotionTypes as default };
