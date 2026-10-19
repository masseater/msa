import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";

import { fileSize, isFile, joinPath, listDirectory, pathExists } from "./platform-support.ts";

export type DiskFootprint =
  | {
      readonly kind: "sqlite";
      readonly mainBytes: number;
      readonly auxiliaryBytes: number;
      readonly fileCount: number;
      readonly pageCount: number;
      readonly freelistCount: number;
    }
  | {
      readonly kind: "jsonl";
      readonly mainBytes: number;
      readonly auxiliaryBytes: number;
      readonly fileCount: number;
      readonly documentFiles: number;
      readonly taskFiles: number;
    };

const sizeOrZero = Effect.fn("sizeOrZero")(function* (path: string) {
  return (yield* pathExists(path)) ? yield* fileSize(path) : 0;
});

function sqliteMetrics(path: string): Extract<DiskFootprint, { readonly kind: "sqlite" }> {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const pageCount = database
      .prepare("SELECT page_count AS value FROM pragma_page_count()")
      .get() as {
      readonly value: number;
    };
    const freelistCount = database
      .prepare("SELECT freelist_count AS value FROM pragma_freelist_count()")
      .get() as {
      readonly value: number;
    };
    return {
      kind: "sqlite",
      mainBytes: 0,
      auxiliaryBytes: 0,
      fileCount: 0,
      pageCount: pageCount.value,
      freelistCount: freelistCount.value,
    };
  } finally {
    database.close();
  }
}

const jsonlMetrics = Effect.fn("jsonlMetrics")(function* (directory: string) {
  const entries = yield* listDirectory(directory);
  let mainBytes = 0;
  let auxiliaryBytes = 0;
  let fileCount = 0;
  let documentFiles = 0;
  let taskFiles = 0;
  for (const name of entries) {
    const path = joinPath(directory, name);
    if (!(yield* isFile(path))) continue;
    const bytes = yield* sizeOrZero(path);
    fileCount++;
    if (name === "main.jsonl") mainBytes += bytes;
    else auxiliaryBytes += bytes;
    if (name.startsWith("doc-") && name.endsWith(".jsonl")) documentFiles++;
    if (name.startsWith("task-") && name.endsWith(".jsonl")) taskFiles++;
  }
  const footprint: DiskFootprint = {
    kind: "jsonl",
    mainBytes,
    auxiliaryBytes,
    fileCount,
    documentFiles,
    taskFiles,
  };
  return footprint;
});

export const diskFootprint = Effect.fn("diskFootprint")(function* (
  backend: "memory" | "sqlite" | "jsonl",
  path: string | undefined,
) {
  let disk: DiskFootprint | undefined;
  if (path !== undefined && backend === "sqlite") {
    disk = {
      ...sqliteMetrics(path),
      mainBytes: yield* sizeOrZero(path),
      auxiliaryBytes: (yield* sizeOrZero(`${path}-wal`)) + (yield* sizeOrZero(`${path}-shm`)),
      fileCount: 3,
    };
  } else if (path !== undefined) {
    disk = yield* jsonlMetrics(path);
  }
  return disk;
});
