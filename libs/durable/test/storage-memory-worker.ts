import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import testing from "@msa/durable/testing";
import { Console, Effect } from "effect";

import nodeModule from "../src/storage/jsonl/node.ts";
import memory from "../src/storage/memory.ts";
import node from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import diskFootprint from "./storage-disk-footprint.ts";
import type storageMemoryWorkerTypes from "./storage-memory-worker.types.ts";

const { MemoryStorage } = memory;
const { openNodeSqliteStorage } = node;
const { openNodeJsonlStorage } = nodeModule;
const { STORAGE_READ_BENCHMARKS, seedStorageBenchmark, storageBenchmarkPrimaryRecordCount } =
  testing;

const { awaited, toJsonText } = effectSupport;
const { makeTempFile, removeDir } = platformSupport;

const STORAGE_BENCHMARK_BACKENDS: readonly storageMemoryWorkerTypes.StorageBenchmarkBackend[] = [
  "memory",
  "sqlite",
  "jsonl",
];

function collectGarbage(): void {
  if (globalThis.gc === undefined)
    throw new Error(
      "storageMemoryWorkerTypes.Storage memory measurement requires Node.js --expose-gc",
    );
  for (let index = 0; index < 3; index++) globalThis.gc();
}

function snapshot(): storageMemoryWorkerTypes.MemorySnapshot {
  const usage = process.memoryUsage();
  return { external: usage.external, heapUsed: usage.heapUsed, rss: usage.rss };
}

const openBenchmarkStorage = Effect.fn("openBenchmarkStorage")(function* (
  backend: storageMemoryWorkerTypes.StorageBenchmarkBackend,
) {
  let storage: storageMemoryWorkerTypes.Storage;
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
  return { directory, path, storage };
});

const readEveryScenario = Effect.fn("readEveryScenario")(function* (
  storage: storageMemoryWorkerTypes.Storage,
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
  if (!Number.isFinite(checksum))
    throw new Error("storageMemoryWorkerTypes.Storage memory read checksum is invalid");
});

const runWorker = Effect.fn("runWorker")(function* (
  backend: storageMemoryWorkerTypes.StorageBenchmarkBackend,
  scale: storageMemoryWorkerTypes.StorageBenchmarkScale,
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
        baseline,
        disk,
        postRead,
        postSeed,
        recordCount,
        scale: scale.name,
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

const storageMemoryWorker = {
  STORAGE_BENCHMARK_BACKENDS,
  runWorker,
};

export default storageMemoryWorker;
