import type benchSupportTypes from "./bench-support.types.ts";

declare namespace nestedImagesBenchToolsTypes {
  type Variant = "inline" | "reference";

  type Scenario = {
    backend: benchSupportTypes.Backend;
    variant: Variant;
    count: number;
    bytes: number;
  };
}

export type { nestedImagesBenchToolsTypes as default };
