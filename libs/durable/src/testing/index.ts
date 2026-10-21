import assertions from "./assertions.ts";
import envConformance from "./env-conformance.ts";
import runnerModule from "./runner.ts";
import storageBenchmarkRuns from "./storage-benchmark-runs.ts";
import storageBenchmarkSeed from "./storage-benchmark-seed.ts";
import storageBenchmark from "./storage-benchmark.ts";
import storageConformance from "./storage-conformance.ts";

const testing = {
  STORAGE_MEMORY_SCALES: storageBenchmark.STORAGE_MEMORY_SCALES,
  STORAGE_READ_BENCHMARKS: storageBenchmarkRuns.STORAGE_READ_BENCHMARKS,
  STORAGE_WRITE_BENCHMARKS: storageBenchmarkRuns.STORAGE_WRITE_BENCHMARKS,
  TIMING_SCALE: storageBenchmark.TIMING_SCALE,
  createEnvConformance: envConformance.createEnvConformance,
  createExpectAssertions: assertions.createExpectAssertions,
  createStorageConformance: storageConformance.createStorageConformance,
  registerEnvConformance: runnerModule.registerEnvConformance,
  registerStorageConformance: runnerModule.registerStorageConformance,
  seedStorageBenchmark: storageBenchmarkSeed.seedStorageBenchmark,
  seedStorageWriteBenchmark: storageBenchmarkSeed.seedStorageWriteBenchmark,
  storageBenchmarkPrimaryRecordCount: storageBenchmark.storageBenchmarkPrimaryRecordCount,
};

export default testing;
