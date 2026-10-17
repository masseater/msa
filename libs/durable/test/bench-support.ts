import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";

import type { Storage, StorageWrite } from "../src/index.ts";
import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";

export type Backend = "sqlite" | "jsonl";
export type Written = Record<StorageWrite["type"], number>;

const gc = (globalThis as { gc?: () => void }).gc;

export function requireGc(): void {
  if (gc === undefined) throw new Error("Run with --expose-gc");
}

export function heapAfterGc(): number {
  gc!();
  return process.memoryUsage().heapUsed;
}

export async function directorySize(path: string): Promise<number> {
  let total = 0;
  for await (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    total += entry.isDirectory() ? await directorySize(full) : (await stat(full)).size;
  }
  return total;
}

export function openBenchStorage(backend: Backend, directory: string): Promise<Storage> {
  return Promise.resolve(
    backend === "sqlite"
      ? openNodeSqliteStorage(join(directory, "session.sqlite"))
      : openNodeJsonlStorage(directory, context),
  );
}

export function noWrites(): Written {
  return {
    conversation: 0,
    entry: 0,
    task: 0,
    submission: 0,
    "document.create": 0,
    "document.copy": 0,
    "document.change": 0,
    "document.retire": 0,
  };
}

// Counts each commit of `storage` in `meter`, calls `onCommit`, and adds the JSON characters of its writes per type.
export function meterCommits(
  storage: Storage,
  meter: { commits: number; readonly written: Written },
  onCommit?: () => void,
): void {
  const commit = storage.commit.bind(storage);
  storage.commit = (writes, commitContext) => {
    meter.commits++;
    onCommit?.();
    for (const write of writes) meter.written[write.type] += JSON.stringify(write).length;
    return commit(writes, commitContext);
  };
}
