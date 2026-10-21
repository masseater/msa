import type TreeSelectorComponentClass from "./tree-selector.ts";

declare namespace treeSelectorTypes {
  type FilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

  type TreeSelectorComponent = (typeof TreeSelectorComponentClass)["prototype"];
}

export type { treeSelectorTypes as default };
