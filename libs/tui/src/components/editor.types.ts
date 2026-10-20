import type EditorClass from "./editor.ts";
import type selectListTypes from "./select-list.types.ts";

declare namespace editorTypes {
  interface EditorTheme {
    borderColor: (str: string) => string;
    selectList: selectListTypes.SelectListTheme;
  }

  interface EditorOptions {
    paddingX?: number;
    autocompleteMaxVisible?: number;
  }

  type Editor = EditorClass;
}

export type { editorTypes as default };
