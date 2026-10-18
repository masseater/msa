import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Effect } from "effect";

import type { Storage, StorageWrite } from "../src/index.ts";
import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { fileSize, isDirectory, joinPath, listTree } from "./platform-support.ts";

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

export const directorySize = Effect.fn("directorySize")(function* (path: string) {
  let total = 0;
  for (const entry of yield* listTree(path)) {
    const full = joinPath(path, entry);
    if (!(yield* isDirectory(full))) total += yield* fileSize(full);
  }
  return total;
});

export function openBenchStorage(backend: Backend, directory: string): Promise<Storage> {
  return Promise.resolve(
    backend === "sqlite"
      ? openNodeSqliteStorage(joinPath(directory, "session.sqlite"))
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
