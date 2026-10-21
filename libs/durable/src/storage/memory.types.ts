import type typesModule from "../types.types.ts";
import type memory from "./memory.ts";

declare namespace memoryTypes {
  interface PreparedMemoryCommit {
    readonly seq: typesModule.Seq;
    readonly writes: readonly typesModule.StorageWrite[];
    apply(): typesModule.Seq;
  }

  type MemoryStorage = (typeof memory.MemoryStorage)["prototype"];
}

export type { memoryTypes as default };
