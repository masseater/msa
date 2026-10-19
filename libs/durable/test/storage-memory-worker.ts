import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import {
  STORAGE_READ_BENCHMARKS,
  type StorageBenchmarkScale,
  seedStorageBenchmark,
  storageBenchmarkPrimaryRecordCount,
} from "@msa/durable/testing";
import { Console, Effect } from "effect";

import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import type { Storage } from "../src/types.ts";
import { toJsonText, awaited } from "./effect-support.ts";
import { makeTempFile, removeDir } from "./platform-support.ts";
import { type DiskFootprint, diskFootprint } from "./storage-disk-footprint.ts";

export const STORAGE_BENCHMARK_BACKENDS = ["memory", "sqlite", "jsonl"] as const;

type StorageBenchmarkBackend = (typeof STORAGE_BENCHMARK_BACKENDS)[number];

export type MemorySnapshot = {
  readonly heapUsed: number;
  readonly rss: number;
  readonly external: number;
};

export type StorageMemoryResult = {
  readonly backend: StorageBenchmarkBackend;
  readonly scale: string;
  readonly recordCount: number;
  readonly baseline: MemorySnapshot;
  readonly postSeed: MemorySnapshot;
  readonly postRead: MemorySnapshot;
  readonly disk?: DiskFootprint;
};

function collectGarbage(): void {
  if (globalThis.gc === undefined)
    throw new Error("Storage memory measurement requires Node.js --expose-gc");
  for (let index = 0; index < 3; index++) globalThis.gc();
}

function snapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, rss: usage.rss, external: usage.external };
}

const openBenchmarkStorage = Effect.fn("openBenchmarkStorage")(function* (
  backend: StorageBenchmarkBackend,
) {
  let storage: Storage;
  let directory: string | undefined;
  let path: string | undefined;
  if (backend === "memory") {
    storage = new MemoryStorage();
  } else {
    const name = backend === "sqlite" ? "storage.sqlite" : "storage";
    ({ directory, path } = yield* makeTempFile(`msa-durable-${backend}-memory-`, name));
    storage =
      backend === "sqlite"
        ? yield* awaited(openNodeSqliteStorage(path))
        : yield* awaited(openNodeJsonlStorage(path, BACKGROUND_CONTEXT));
  }
  return { storage, directory, path };
});

const readEveryScenario = Effect.fn("readEveryScenario")(function* (
  storage: Storage,
  dataset: Awaited<ReturnType<typeof seedStorageBenchmark>>,
) {
  let checksum = 0;
  for (const scenario of STORAGE_READ_BENCHMARKS) {
    const result = yield* awaited(scenario.run(storage, dataset));
    if (result !== scenario.expected(dataset))
      throw new Error(`Invalid benchmark result: ${scenario.name}`);
    checksum += result;
  }
  for (const _ of Array.from({ length: 9 })) {
    for (const scenario of STORAGE_READ_BENCHMARKS)
      checksum += yield* awaited(scenario.run(storage, dataset));
  }
  if (!Number.isFinite(checksum)) throw new Error("Storage memory read checksum is invalid");
});

export const runWorker = Effect.fn("runWorker")(function* (
  backend: StorageBenchmarkBackend,
  scale: StorageBenchmarkScale,
) {
  const { storage, directory, path } = yield* openBenchmarkStorage(backend);

  yield* Effect.gen(function* () {
    collectGarbage();
    const baseline = snapshot();
    const dataset = yield* awaited(seedStorageBenchmark(storage, scale));
    collectGarbage();
    const postSeed = snapshot();
    yield* readEveryScenario(storage, dataset);
    collectGarbage();
    const postRead = snapshot();
    const disk = yield* diskFootprint(backend, path);
    const recordCount = storageBenchmarkPrimaryRecordCount(scale);
    yield* Console.log(
      yield* toJsonText({
        backend,
        scale: scale.name,
        recordCount,
        baseline,
        postSeed,
        postRead,
        disk,
      }),
    );
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* awaited(storage.close(BACKGROUND_CONTEXT));
        if (directory !== undefined) yield* removeDir(directory);
      }),
    ),
  );
});
