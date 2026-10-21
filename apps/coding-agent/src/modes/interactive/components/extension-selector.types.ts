import type tuiTypes from "@msa/tui/index.types";

import type ExtensionSelectorComponentClass from "./extension-selector.ts";

declare namespace extensionSelectorTypes {
  interface ExtensionSelectorOptions {
    tui?: tuiTypes.TUI | undefined;
    timeout?: number | undefined;
    onToggleToolsExpanded?: (() => void) | undefined;
    description?: string | undefined;
  }

  type ExtensionSelectorComponent = (typeof ExtensionSelectorComponentClass)["prototype"];
}

export type { extensionSelectorTypes as default };
