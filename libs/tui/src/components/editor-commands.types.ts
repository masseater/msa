import type EditorCommandsClass from "./editor-commands.ts";

declare namespace editorCommandsTypes {
  interface EditorCommandHost {
    terminalRows(): number;
    isSubmitDisabled(): boolean;
    submit(text: string): void;
  }

  type EditorCommands = EditorCommandsClass;
}

export type { editorCommandsTypes as default };
