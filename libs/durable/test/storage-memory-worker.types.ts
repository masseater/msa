import type testingTypes from "@msa/durable/testing.types";

import type typesModule from "../src/types.types.ts";
import type storageDiskFootprintTypes from "./storage-disk-footprint.types.ts";

declare namespace storageMemoryWorkerTypes {
  type Storage = typesModule.Storage;

  type StorageBenchmarkBackend = "jsonl" | "memory" | "sqlite";

  type MemorySnapshot = {
    readonly heapUsed: number;
    readonly rss: number;
    readonly external: number;
  };

  type StorageMemoryResult = {
    readonly backend: StorageBenchmarkBackend;
    readonly scale: string;
    readonly recordCount: number;
    readonly baseline: MemorySnapshot;
    readonly postSeed: MemorySnapshot;
    readonly postRead: MemorySnapshot;
    readonly disk?: storageDiskFootprintTypes.DiskFootprint;
  };

  type StorageBenchmarkScale = testingTypes.StorageBenchmarkScale;
}

export type { storageMemoryWorkerTypes as default };
