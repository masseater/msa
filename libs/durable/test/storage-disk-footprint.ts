import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";

import platformSupport from "./platform-support.ts";
import type storageDiskFootprintTypes from "./storage-disk-footprint.types.ts";

const { fileSize, isFile, joinPath, listDirectory, pathExists } = platformSupport;

const sizeOrZero = Effect.fn("sizeOrZero")(function* (path: string) {
  return (yield* pathExists(path)) ? yield* fileSize(path) : 0;
});

function sqliteMetrics(
  path: string,
): Extract<storageDiskFootprintTypes.DiskFootprint, { readonly kind: "sqlite" }> {
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
      auxiliaryBytes: 0,
      fileCount: 0,
      freelistCount: freelistCount.value,
      kind: "sqlite",
      mainBytes: 0,
      pageCount: pageCount.value,
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
  const footprint: storageDiskFootprintTypes.DiskFootprint = {
    auxiliaryBytes,
    documentFiles,
    fileCount,
    kind: "jsonl",
    mainBytes,
    taskFiles,
  };
  return footprint;
});

const diskFootprint = Effect.fn("diskFootprint")(function* (
  backend: "memory" | "sqlite" | "jsonl",
  path: string | undefined,
) {
  let disk: storageDiskFootprintTypes.DiskFootprint | undefined;
  if (path !== undefined && backend === "sqlite") {
    disk = {
      ...sqliteMetrics(path),
      auxiliaryBytes: (yield* sizeOrZero(`${path}-wal`)) + (yield* sizeOrZero(`${path}-shm`)),
      fileCount: 3,
      mainBytes: yield* sizeOrZero(path),
    };
  } else if (path !== undefined) {
    disk = yield* jsonlMetrics(path);
  }
  return disk;
});

export default diskFootprint;
