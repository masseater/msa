import type { Context as ContextSource, JsonValue as JsonValueSource } from "@msa/chord";

import type { TaskRecord } from "../src/types.ts";
import type jsonlStorageSupport from "./jsonl-storage-support.ts";

declare namespace jsonlStorageSupportTypes {
  type Context = ContextSource;

  type JsonValue = JsonValueSource;

  type StoredTask = TaskRecord<JsonValueSource, JsonValueSource, JsonValueSource>;

  type Failure = {
    readonly operation: "append" | "flush" | "write" | "rename" | "remove";
    readonly call: number;
    readonly mode: "before" | "after" | "short";
  };

  type InstrumentedEnv = (typeof jsonlStorageSupport.InstrumentedEnv)["prototype"];
}

export type { jsonlStorageSupportTypes as default };
