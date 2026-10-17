import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import {
  STORAGE_READ_BENCHMARKS,
  type StorageBenchmarkScale,
  seedStorageBenchmark,
  storageBenchmarkPrimaryRecordCount,
} from "@msa/durable/testing";

import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import type { Storage } from "../src/types.ts";
import { type DiskFootprint, diskFootprint } from "./storage-disk-footprint.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

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

async function openBenchmarkStorage(backend: StorageBenchmarkBackend) {
  let storage: Storage;
  let directory: string | undefined;
  let path: string | undefined;
  if (backend === "memory") {
    storage = new MemoryStorage();
  } else {
    const name = backend === "sqlite" ? "storage.sqlite" : "storage";
    ({ directory, path } = await makeTempFile(`msa-durable-${backend}-memory-`, name));
    storage =
      backend === "sqlite"
        ? await openNodeSqliteStorage(path)
        : await openNodeJsonlStorage(path, BACKGROUND_CONTEXT);
  }
  return { storage, directory, path };
}

// Read every scenario once checking its result, then nine more times.
async function readEveryScenario(
  storage: Storage,
  dataset: Awaited<ReturnType<typeof seedStorageBenchmark>>,
): Promise<void> {
  let checksum = 0;
  for await (const scenario of STORAGE_READ_BENCHMARKS) {
    const result = await scenario.run(storage, dataset);
    if (result !== scenario.expected(dataset))
      throw new Error(`Invalid benchmark result: ${scenario.name}`);
    checksum += result;
  }
  for await (const _ of Array.from({ length: 9 })) {
    for await (const scenario of STORAGE_READ_BENCHMARKS)
      checksum += await scenario.run(storage, dataset);
  }
  if (!Number.isFinite(checksum)) throw new Error("Storage memory read checksum is invalid");
}

export async function runWorker(
  backend: StorageBenchmarkBackend,
  scale: StorageBenchmarkScale,
): Promise<void> {
  const { storage, directory, path } = await openBenchmarkStorage(backend);

  try {
    collectGarbage();
    const baseline = snapshot();
    const dataset = await seedStorageBenchmark(storage, scale);
    collectGarbage();
    const postSeed = snapshot();
    await readEveryScenario(storage, dataset);
    collectGarbage();
    const postRead = snapshot();
    const disk = await diskFootprint(backend, path);
    const recordCount = storageBenchmarkPrimaryRecordCount(scale);
    console.log(
      JSON.stringify({
        backend,
        scale: scale.name,
        recordCount,
        baseline,
        postSeed,
        postRead,
        disk,
      }),
    );
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
    if (directory !== undefined) await removeDir(directory);
  }
}
