import type tuiTypes from "@msa/tui/index.types";

import type ExtensionEditorComponentClass from "./extension-editor.ts";

declare namespace extensionEditorTypes {
  interface ExtensionEditorOptions extends tuiTypes.EditorOptions {
    description?: string;
  }

  type ExtensionEditorComponent = (typeof ExtensionEditorComponentClass)["prototype"];
}

export type { extensionEditorTypes as default };
