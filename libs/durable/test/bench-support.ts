import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type durableTypes from "../src/index.types.ts";
import nodeModule from "../src/storage/jsonl/node.ts";
import node from "../src/storage/sqlite/node.ts";
import type benchSupportTypes from "./bench-support.types.ts";
import platformSupport from "./platform-support.ts";

const { openNodeSqliteStorage } = node;
const { openNodeJsonlStorage } = nodeModule;

const { fileSize, isDirectory, joinPath, listTree } = platformSupport;

const gc = (globalThis as { gc?: () => void }).gc;

function requireGc(): void {
  if (gc === undefined) throw new Error("Run with --expose-gc");
}

function heapAfterGc(): number {
  gc!();
  return process.memoryUsage().heapUsed;
}

const directorySize = Effect.fn("directorySize")(function* (path: string) {
  let total = 0;
  for (const entry of yield* listTree(path)) {
    const full = joinPath(path, entry);
    if (!(yield* isDirectory(full))) total += yield* fileSize(full);
  }
  return total;
});

function openBenchStorageImpl(
  backend: benchSupportTypes.Backend,
  directory: string,
): Promise<durableTypes.Storage> {
  return Promise.resolve(
    backend === "sqlite"
      ? openNodeSqliteStorage(joinPath(directory, "session.sqlite"))
      : openNodeJsonlStorage(directory, context),
  );
}

const openBenchStorage: {
  (
    directory: string,
  ): (backend: benchSupportTypes.Backend) => ReturnType<typeof openBenchStorageImpl>;
  (backend: benchSupportTypes.Backend, directory: string): ReturnType<typeof openBenchStorageImpl>;
} = dual(2, openBenchStorageImpl);

function noWrites(): benchSupportTypes.Written {
  return {
    conversation: 0,
    "document.change": 0,
    "document.copy": 0,
    "document.create": 0,
    "document.retire": 0,
    entry: 0,
    submission: 0,
    task: 0,
  };
}

function meterCommitsImpl(
  storage: durableTypes.Storage,
  meter: { commits: number; readonly written: benchSupportTypes.Written },
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

const meterCommits: {
  (
    meter: { commits: number; readonly written: benchSupportTypes.Written },
    onCommit?: () => void,
  ): (storage: durableTypes.Storage) => ReturnType<typeof meterCommitsImpl>;
  (
    storage: durableTypes.Storage,
    meter: { commits: number; readonly written: benchSupportTypes.Written },
    onCommit?: () => void,
  ): ReturnType<typeof meterCommitsImpl>;
} = dual((args) => typeof args[1] === "object", meterCommitsImpl);

const benchSupport = {
  directorySize,
  heapAfterGc,
  meterCommits,
  noWrites,
  openBenchStorage,
  requireGc,
};

export default benchSupport;
