import type typesModule from "../types.types.ts";
import type storageBenchmarkTypes from "./storage-benchmark.types.ts";

declare namespace storageBenchmarkRunsTypes {
  type StorageReadBenchmark = {
    readonly name: string;
    run(
      storage: typesModule.Storage,
      dataset: storageBenchmarkTypes.StorageBenchmarkDataset,
    ): Promise<number>;
    expected(dataset: storageBenchmarkTypes.StorageBenchmarkDataset): number;
  };

  type StorageWriteBenchmark = {
    readonly name: string;
    readonly expected: number;
    run(storage: typesModule.Storage): Promise<number>;
  };
}

export type { storageBenchmarkRunsTypes as default };
