import type envTypes from "../../env/index.types.ts";
import type memoryTypes from "../memory.types.ts";
import type filesTypes from "./files.types.ts";
import type poisonedErrorTypes from "./poisoned-error.types.ts";
import type JsonlStorageClass from "./storage.ts";

declare namespace storageTypes {
  type JsonlStorageOptions = {
    readonly fsync?: boolean;
  };

  type JsonlStorage = JsonlStorageClass;

  type FileSystem = envTypes.FileSystem;

  type JsonlFiles = filesTypes.JsonlFiles;

  type MemoryStorage = memoryTypes.MemoryStorage;

  type JsonlStoragePoisonedError = poisonedErrorTypes.JsonlStoragePoisonedError;
}

export type { storageTypes as default };
