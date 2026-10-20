import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import testing from "@msa/durable/testing";
import { Console, Effect } from "effect";

import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import storageMemoryWorker from "./storage-memory-worker.ts";
import type storageMemoryWorkerTypes from "./storage-memory-worker.types.ts";

const { STORAGE_MEMORY_SCALES } = testing;

const { fromJsonText } = effectSupport;
const { runCommandOrFail } = platformSupport;
const { STORAGE_BENCHMARK_BACKENDS, runWorker } = storageMemoryWorker;

function delta(
  after: storageMemoryWorkerTypes.MemorySnapshot,
  before: storageMemoryWorkerTypes.MemorySnapshot,
  field: keyof storageMemoryWorkerTypes.MemorySnapshot,
): number {
  return after[field] - before[field];
}

function mebibytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

const runWorkers = Effect.fn("runWorkers")(function* (workerPath: string) {
  const results: storageMemoryWorkerTypes.StorageMemoryResult[] = [];
  for (const backend of STORAGE_BENCHMARK_BACKENDS) {
    for (const scale of STORAGE_MEMORY_SCALES) {
      const stdout = yield* runCommandOrFail(
        process.execPath,
        [
          "--conditions=source",
          "--expose-gc",
          "--experimental-strip-types",
          workerPath,
          "--worker",
          backend,
          scale.name,
        ],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
        },
      );
      results.push((yield* fromJsonText(stdout)) as storageMemoryWorkerTypes.StorageMemoryResult);
    }
  }
  return results;
});

function summaryRow(result: storageMemoryWorkerTypes.StorageMemoryResult) {
  return {
    "JS heap bytes/primary record": Math.round(
      delta(result.postSeed, result.baseline, "heapUsed") / result.recordCount,
    ),
    "RSS after seed MiB": mebibytes(delta(result.postSeed, result.baseline, "rss")),
    backend: result.backend,
    "disk auxiliary MiB": result.disk === undefined ? "-" : mebibytes(result.disk.auxiliaryBytes),
    "disk detail":
      result.disk === undefined
        ? "-"
        : result.disk.kind === "sqlite"
          ? `pages/free ${result.disk.pageCount}/${result.disk.freelistCount}`
          : `documents/tasks ${result.disk.documentFiles}/${result.disk.taskFiles}`,
    "disk files": result.disk?.fileCount ?? "-",
    "disk main MiB": result.disk === undefined ? "-" : mebibytes(result.disk.mainBytes),
    "disk total MiB":
      result.disk === undefined
        ? "-"
        : mebibytes(result.disk.mainBytes + result.disk.auxiliaryBytes),
    "external after seed MiB": mebibytes(delta(result.postSeed, result.baseline, "external")),
    "heap after reads MiB": mebibytes(delta(result.postRead, result.postSeed, "heapUsed")),
    "heap after seed MiB": mebibytes(delta(result.postSeed, result.baseline, "heapUsed")),
    scale: result.scale,
  };
}

const runDriver = Effect.fn("runDriver")(function* () {
  const workerPath = fileURLToPath(import.meta.url);
  const results = yield* runWorkers(workerPath);

  yield* Console.log(
    "Storage footprint after deterministic synthetic workloads; values are process deltas, not limits.",
  );
  yield* Console.table(results.map(summaryRow));
});

const [mode, backendName, scaleName] = process.argv.slice(2);

const main = Effect.gen(function* () {
  if (mode === "--worker") {
    const backend = STORAGE_BENCHMARK_BACKENDS.find((candidate) => candidate === backendName);
    if (backend === undefined) throw new Error(`Unknown storage benchmark backend: ${backendName}`);
    const scale = STORAGE_MEMORY_SCALES.find((candidate) => candidate.name === scaleName);
    if (scale === undefined) throw new Error(`Unknown storage benchmark scale: ${scaleName}`);
    yield* runWorker(backend, scale);
  } else {
    yield* runDriver();
  }
});

NodeRuntime.runMain(main);
