import type { StorageWrite } from "../src/index.ts";

declare namespace benchSupportTypes {
  type Backend = "sqlite" | "jsonl";

  type Written = Record<StorageWrite["type"], number>;
}

export type { benchSupportTypes as default };
