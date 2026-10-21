import type durableTypes from "../src/index.types.ts";
import type nestedImagesBenchToolsTypes from "./nested-images-bench-tools.types.ts";

declare namespace nestedImagesBenchTypes {
  type Scenario = nestedImagesBenchToolsTypes.Scenario;

  type Storage = durableTypes.Storage;

  type StorageWrite = durableTypes.StorageWrite;

  type ToolTaskInput = durableTypes.ToolTaskInput;
}

export type { nestedImagesBenchTypes as default };
