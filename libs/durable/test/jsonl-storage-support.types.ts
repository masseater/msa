import type chordTypes from "@msa/chord/index.types";

import type envTypes from "../src/env/index.types.ts";
import type jsonlTypes from "../src/storage/jsonl/index.types.ts";
import type typesModule from "../src/types.types.ts";
import type jsonlStorageSupport from "./jsonl-storage-support.ts";

declare namespace jsonlStorageSupportTypes {
  type Context = chordTypes.Context;

  type JsonValue = chordTypes.JsonValue;

  type StoredTask = typesModule.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;

  type Failure = {
    readonly operation: "append" | "flush" | "write" | "rename" | "remove";
    readonly call: number;
    readonly mode: "before" | "after" | "short";
  };

  type InstrumentedEnv = (typeof jsonlStorageSupport.InstrumentedEnv)["prototype"];

  type JsonlStorage = jsonlTypes.JsonlStorage;

  type FileError = envTypes.FileError;

  type FileSystem = envTypes.FileSystem;

  type Result<TValue, TError> = envTypes.Result<TValue, TError>;
}

export type { jsonlStorageSupportTypes as default };
