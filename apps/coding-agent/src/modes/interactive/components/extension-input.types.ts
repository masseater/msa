import type tuiTypes from "@msa/tui/index.types";

import type ExtensionInputComponentClass from "./extension-input.ts";

declare namespace extensionInputTypes {
  interface ExtensionInputOptions {
    tui?: tuiTypes.TUI | undefined;
    timeout?: number | undefined;
    initialValue?: string | undefined;
    description?: string | undefined;
  }

  type ExtensionInputComponent = (typeof ExtensionInputComponentClass)["prototype"];
}

export type { extensionInputTypes as default };
