import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { STORAGE_MEMORY_SCALES } from "@msa/durable/testing";

import {
  type MemorySnapshot,
  runWorker,
  STORAGE_BENCHMARK_BACKENDS,
  type StorageMemoryResult,
} from "./storage-memory-worker.ts";

const execFileAsync = promisify(execFile);

function delta(after: MemorySnapshot, before: MemorySnapshot, field: keyof MemorySnapshot): number {
  return after[field] - before[field];
}

function mebibytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function runWorkers(workerPath: string): Promise<StorageMemoryResult[]> {
  const results: StorageMemoryResult[] = [];
  for await (const backend of STORAGE_BENCHMARK_BACKENDS) {
    for await (const scale of STORAGE_MEMORY_SCALES) {
      const { stdout } = await execFileAsync(
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
        { cwd: fileURLToPath(new URL("..", import.meta.url)), maxBuffer: 1024 * 1024 },
      );
      results.push(JSON.parse(stdout) as StorageMemoryResult);
    }
  }
  return results;
}

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

async function runDriver(): Promise<void> {
  const workerPath = fileURLToPath(import.meta.url);
  const results = await runWorkers(workerPath);

  console.log(
    "Storage footprint after deterministic synthetic workloads; values are process deltas, not limits.",
  );
  console.table(results.map(summaryRow));
}

const [mode, backendName, scaleName] = process.argv.slice(2);
if (mode === "--worker") {
  const backend = STORAGE_BENCHMARK_BACKENDS.find((candidate) => candidate === backendName);
  if (backend === undefined) throw new Error(`Unknown storage benchmark backend: ${backendName}`);
  const scale = STORAGE_MEMORY_SCALES.find((candidate) => candidate.name === scaleName);
  if (scale === undefined) throw new Error(`Unknown storage benchmark scale: ${scaleName}`);
  await runWorker(backend, scale);
} else {
  await runDriver();
}
