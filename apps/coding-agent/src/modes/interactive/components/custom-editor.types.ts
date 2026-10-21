import type tuiTypes from "@msa/tui/index.types";

import type CustomEditorClass from "./custom-editor.ts";

declare namespace customEditorTypes {
  type CustomEditorOptions = tuiTypes.EditorOptions & {
    embedWorkingStatus?: boolean;
  };

  type CustomEditor = (typeof CustomEditorClass)["prototype"];
}

export type { customEditorTypes as default };
