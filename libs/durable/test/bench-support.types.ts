import type durableTypes from "../src/index.types.ts";

declare namespace benchSupportTypes {
  type Backend = "sqlite" | "jsonl";

  type Written = Record<durableTypes.StorageWrite["type"], number>;
}

export type { benchSupportTypes as default };
