import type EditorDocumentClass from "./editor-document.ts";

declare namespace editorDocumentTypes {
  interface EditorState {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
  }

  type EditorAction = "kill" | "yank" | "type-word" | null;

  interface CompletionResult {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
  }

  type EditorDocument = EditorDocumentClass;
}

export type { editorDocumentTypes as default };
