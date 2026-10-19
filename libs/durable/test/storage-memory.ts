import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { STORAGE_MEMORY_SCALES } from "@msa/durable/testing";
import { Console, Effect } from "effect";

import { fromJsonText } from "./effect-support.ts";
import { runCommandOrFail } from "./platform-support.ts";
import {
  type MemorySnapshot,
  runWorker,
  STORAGE_BENCHMARK_BACKENDS,
  type StorageMemoryResult,
} from "./storage-memory-worker.ts";

function delta(after: MemorySnapshot, before: MemorySnapshot, field: keyof MemorySnapshot): number {
  return after[field] - before[field];
}

function mebibytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

const runWorkers = Effect.fn("runWorkers")(function* (workerPath: string) {
  const results: StorageMemoryResult[] = [];
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
      results.push((yield* fromJsonText(stdout)) as StorageMemoryResult);
    }
  }
  return results;
});

function summaryRow(result: StorageMemoryResult) {
  return {
    backend: result.backend,
    scale: result.scale,
    "heap after seed MiB": mebibytes(delta(result.postSeed, result.baseline, "heapUsed")),
    "RSS after seed MiB": mebibytes(delta(result.postSeed, result.baseline, "rss")),
    "external after seed MiB": mebibytes(delta(result.postSeed, result.baseline, "external")),
    "heap after reads MiB": mebibytes(delta(result.postRead, result.postSeed, "heapUsed")),
    "JS heap bytes/primary record": Math.round(
      delta(result.postSeed, result.baseline, "heapUsed") / result.recordCount,
    ),
    "disk main MiB": result.disk === undefined ? "-" : mebibytes(result.disk.mainBytes),
    "disk auxiliary MiB": result.disk === undefined ? "-" : mebibytes(result.disk.auxiliaryBytes),
    "disk total MiB":
      result.disk === undefined
        ? "-"
        : mebibytes(result.disk.mainBytes + result.disk.auxiliaryBytes),
    "disk files": result.disk?.fileCount ?? "-",
    "disk detail":
      result.disk === undefined
        ? "-"
        : result.disk.kind === "sqlite"
          ? `pages/free ${result.disk.pageCount}/${result.disk.freelistCount}`
          : `documents/tasks ${result.disk.documentFiles}/${result.disk.taskFiles}`,
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
