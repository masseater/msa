import { Effect, FileSystem, Option, Stream } from "effect";

import platform from "../platform/index.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import platformRuntime from "../platform/runtime.ts";
import indexStore from "./index-store.ts";
import lineScan from "./line-scan.ts";
import type sessionSearchTypes from "./session-search.types.ts";

const { join } = platform;
const { BATCH_BYTES, bodyBytes, changedSince, sameBytes, scanLines, skippedUpdate, under } =
  lineScan;
const { whileLocked } = indexStore;

const TAIL_BYTES = 256;
const MAX_DEPTH = 2;

type FoundFile = sessionSearchTypes.FoundFile;

const statOf = (fileSystem: FileSystem.FileSystem, path: string) =>
  fileSystem.stat(path).pipe(
    Effect.map((info) => ({
      directory: info.type === "Directory",
      file: info.type === "File",
      mtime: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
      path,
      size: Number(info.size),
    })),
    Effect.orElseSucceed(() => undefined),
  );

const walk: (
  fileSystem: FileSystem.FileSystem,
  directory: string,
  depth: number,
) => Effect.Effect<FoundFile[]> = Effect.fnUntraced(function* (fileSystem, directory, depth) {
  const names = yield* fileSystem
    .readDirectory(directory)
    .pipe(Effect.orElseSucceed((): readonly string[] => []));
  const stats = yield* Effect.forEach(names, (name) => statOf(fileSystem, join(directory, name)), {
    concurrency: 32,
  });
  const found: FoundFile[] = [];
  const nested: string[] = [];
  for (const entry of stats) {
    if (entry === undefined) continue;
    if (entry.file && entry.path.endsWith(".jsonl")) {
      found.push({ mtime: entry.mtime, path: entry.path, size: entry.size });
    } else if (entry.directory && depth < MAX_DEPTH) {
      nested.push(entry.path);
    }
  }
  const deeper = yield* Effect.forEach(nested, (child) => walk(fileSystem, child, depth + 1), {
    concurrency: 32,
  });
  return [...found, ...deeper.flat()];
});

const readRange = (
  fileSystem: FileSystem.FileSystem,
  path: string,
  start: number,
  end: number | undefined,
) =>
  Stream.runFold(
    fileSystem.stream(path, {
      ...(end === undefined ? {} : { bytesToRead: end - start }),
      chunkSize: 1 << 20,
      offset: start,
    }),
    (): Uint8Array[] => [],
    (chunks, chunk) => {
      chunks.push(chunk);
      return chunks;
    },
  ).pipe(
    Effect.map((chunks) => {
      const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
      let position = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, position);
        position += chunk.length;
      }
      return bytes;
    }),
  );

interface Window {
  bytes: Uint8Array;
  base: number;
  from: number;
}

const readWindow = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  file: FoundFile,
  known: sessionSearchTypes.FileRow | undefined,
) {
  if (known !== undefined) {
    const base = known.indexed - known.tail.length;
    const bytes = yield* readRange(fileSystem, file.path, base, undefined);
    if (sameBytes(bytes.subarray(0, known.tail.length), known.tail)) {
      const window: Window = { base, bytes, from: known.indexed };
      return window;
    }
  }
  const window: Window = {
    base: 0,
    bytes: yield* readRange(fileSystem, file.path, 0, undefined),
    from: 0,
  };
  return window;
});

const scanFile = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  file: FoundFile,
  known: sessionSearchTypes.FileRow | undefined,
) {
  const { base, bytes, from } = yield* readWindow(fileSystem, file, known);
  const scan = scanLines(bytes.subarray(from - base), from);
  const update: sessionSearchTypes.FileUpdate = {
    basis: known,
    failure: undefined,
    from,
    header: scan.header,
    indexed: scan.end,
    mtime: file.mtime,
    orchestrator: scan.orchestrator,
    parts: scan.parts,
    path: file.path,
    size: base + bytes.length,
    tail: bytes.slice(Math.max(0, scan.end - TAIL_BYTES - base), scan.end - base),
  };
  return update;
});

interface Synced {
  changedFiles: number;
  parts: number;
  skipped: sessionSearchTypes.SkippedFile[];
}

const MAX_ATTEMPTS = 20;

const applyScanned = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  database: DatabaseSync,
  indexPath: string,
  files: readonly FoundFile[],
  known: ReadonlyMap<string, sessionSearchTypes.FileRow>,
  synced: Synced,
) {
  const conflicts: string[] = [];
  let batch: sessionSearchTypes.FileUpdate[] = [];
  let batchBytes = 0;
  const flush = Effect.fnUntraced(function* () {
    const full = batch;
    batch = [];
    batchBytes = 0;
    const lost = new Set(
      yield* whileLocked(indexPath, () => indexStore.applyUpdates(database, full)),
    );
    for (const update of full) {
      if (lost.has(update.path)) continue;
      synced.parts += update.parts.length;
      if (update.failure !== undefined) {
        synced.skipped.push({ path: update.path, reason: update.failure });
      }
    }
    conflicts.push(...lost);
  });
  for (const file of files) {
    const basis = known.get(file.path);
    const update = yield* scanFile(fileSystem, file, basis).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.catchDefect((defect) => Effect.succeed(skippedUpdate(file, basis, defect))),
    );
    if (update === undefined) continue;
    batch.push(update);
    batchBytes += bodyBytes(update);
    if (batchBytes >= BATCH_BYTES) yield* flush();
  }
  yield* flush();
  return conflicts;
});

const syncFiles = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  database: DatabaseSync,
  indexPath: string,
  found: readonly FoundFile[],
  rows: ReadonlyMap<string, sessionSearchTypes.FileRow>,
) {
  const known = new Map(rows);
  let pending = found.filter((file) => changedSince(file, known.get(file.path)));
  const synced: Synced = { changedFiles: pending.length, parts: 0, skipped: [] };
  for (let attempt = 0; pending.length > 0 && attempt < MAX_ATTEMPTS; attempt += 1) {
    const conflicts = yield* applyScanned(fileSystem, database, indexPath, pending, known, synced);
    const fresh = yield* whileLocked(indexPath, () =>
      conflicts.map((path) => [path, indexStore.fileRow(database, path)] as const),
    );
    const stats = yield* Effect.forEach(conflicts, (path) => statOf(fileSystem, path), {
      concurrency: 32,
    });
    pending = [];
    for (const [path, row] of fresh) {
      if (row === undefined) known.delete(path);
      else known.set(path, row);
    }
    for (const stat of stats) {
      if (stat?.file !== true) continue;
      const file: FoundFile = { mtime: stat.mtime, path: stat.path, size: stat.size };
      if (changedSince(file, known.get(file.path))) pending.push(file);
    }
  }
  return synced;
});

const updateWith = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  database: DatabaseSync,
  roots: readonly string[],
  indexPath: string,
) {
  const rows = yield* whileLocked(indexPath, () => indexStore.fileRows(database));
  const known = new Map(rows.map((row) => [row.path, row]));
  const listed = yield* Effect.forEach([...new Set(roots)], (root) => walk(fileSystem, root, 0));
  const found = new Map(listed.flat().map((file) => [file.path, file]));
  const removed = rows
    .map((row) => row.path)
    .filter((path) => !found.has(path) && under(path, roots));
  yield* whileLocked(indexPath, () => indexStore.removeFiles(database, removed));
  const synced = yield* syncFiles(fileSystem, database, indexPath, [...found.values()], known);
  const update: sessionSearchTypes.IndexUpdate = {
    changedFiles: synced.changedFiles,
    files: found.size,
    parts: synced.parts,
    removedFiles: removed.length,
    skipped: synced.skipped,
  };
  return update;
});

const updatePathsWith = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  database: DatabaseSync,
  paths: readonly string[],
  indexPath: string,
) {
  const unique = [...new Set(paths)];
  const rows = yield* whileLocked(indexPath, () =>
    unique.flatMap((path) => indexStore.fileRow(database, path) ?? []),
  );
  const known = new Map(rows.map((row) => [row.path, row]));
  const stats = yield* Effect.forEach(unique, (path) => statOf(fileSystem, path), {
    concurrency: 32,
  });
  const found: FoundFile[] = [];
  const gone: string[] = [];
  for (const [index, path] of unique.entries()) {
    const stat = stats[index];
    if (stat?.file === true) found.push({ mtime: stat.mtime, path, size: stat.size });
    else gone.push(path);
  }
  const removed = yield* whileLocked(indexPath, () => indexStore.removeFiles(database, gone));
  const synced = yield* syncFiles(fileSystem, database, indexPath, found, known);
  return removed + synced.changedFiles;
});

const updateIndex = (
  database: DatabaseSync,
  roots: readonly string[],
  indexPath: string,
): Promise<sessionSearchTypes.IndexUpdate> =>
  platformRuntime.runPromise(
    FileSystem.FileSystem.use((fileSystem) => updateWith(fileSystem, database, roots, indexPath)),
  );

const updatePaths = (
  database: DatabaseSync,
  paths: readonly string[],
  indexPath: string,
): Promise<number> =>
  platformRuntime.runPromise(
    FileSystem.FileSystem.use((fileSystem) =>
      updatePathsWith(fileSystem, database, paths, indexPath),
    ),
  );

const readSlice = (path: string, start: number, end: number): Promise<Uint8Array> =>
  platformRuntime.runPromise(
    FileSystem.FileSystem.use((fileSystem) => readRange(fileSystem, path, start, end)),
  );

const indexer = { readSlice, updateIndex, updatePaths };

export default indexer;
