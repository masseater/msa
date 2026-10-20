import type durableTypes from "../src/index.types.ts";
import type benchSupportTypes from "./bench-support.types.ts";

declare namespace nestedToolsBenchTypes {
  type Backend = benchSupportTypes.Backend;

  type Conversation = durableTypes.Conversation;

  type StorageWrite = durableTypes.StorageWrite;
}

export type { nestedToolsBenchTypes as default };
