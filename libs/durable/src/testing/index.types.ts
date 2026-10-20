import type assertionsTypes from "./assertions.types.ts";
import type runnerTypes from "./runner.types.ts";
import type storageBenchmarkRunsTypes from "./storage-benchmark-runs.types.ts";
import type storageBenchmarkTypes from "./storage-benchmark.types.ts";
import type typesModule from "./types.ts";

declare namespace testingTypes {
  type ExpectLike = assertionsTypes.ExpectLike;

  type StorageConformanceRunner = runnerTypes.StorageConformanceRunner;

  type StorageBenchmarkDataset = storageBenchmarkTypes.StorageBenchmarkDataset;

  type StorageBenchmarkScale = storageBenchmarkTypes.StorageBenchmarkScale;

  type StorageReadBenchmark = storageBenchmarkRunsTypes.StorageReadBenchmark;

  type StorageWriteBenchmark = storageBenchmarkRunsTypes.StorageWriteBenchmark;

  type EnvConformanceAssertions = typesModule.EnvConformanceAssertions;

  type EnvConformanceCase = typesModule.EnvConformanceCase;

  type EnvConformanceOptions = typesModule.EnvConformanceOptions;

  type EnvConformanceProvider = typesModule.EnvConformanceProvider;

  type StorageConformanceAssertions = typesModule.StorageConformanceAssertions;

  type StorageConformanceCase = typesModule.StorageConformanceCase;

  type StorageConformanceOptions = typesModule.StorageConformanceOptions;

  type StorageConformanceProvider = typesModule.StorageConformanceProvider;
}

export type { testingTypes as default };
