import { Effect, FileSystem, Option, Stream } from "effect";

import toolNames from "../orchestrator/tool-names.ts";
import platform from "../platform/index.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import platformRuntime from "../platform/runtime.ts";
import sessionFormat from "../session-manager/session-format.ts";
import entryPartsModule from "./entry-parts.ts";
import indexStore from "./index-store.ts";
import type sessionSearchTypes from "./session-search.types.ts";
import terms from "./terms.ts";

const { isAbsolute, join, relative, toEpochMs } = platform;
const { parseSessionEntryLine } = sessionFormat;
const { entryParts, isRecord } = entryPartsModule;
const { isOrchestratorTool } = toolNames;
const { whileLocked } = indexStore;

const TAIL_BYTES = 256;
const MAX_DEPTH = 2;
const NEWLINE = 10;

interface FoundFile {
  path: string;
  size: number;
  mtime: number;
}

const under = (path: string, roots: readonly string[]): boolean =>
  roots.some((root) => {
    const inside = relative(root, path);
    return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  });

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

const readRange = (fileSystem: FileSystem.FileSystem, path: string, start: number, end: number) =>
  Stream.runFold(
    fileSystem.stream(path, { bytesToRead: end - start, chunkSize: 1 << 20, offset: start }),
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

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

const timeOf = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const time = toEpochMs(value);
  return Number.isNaN(time) ? null : time;
};

interface LineScan {
  parts: sessionSearchTypes.PartRow[];
  header: sessionSearchTypes.SessionHeader | undefined;
  orchestrator: boolean;
}

function headerOf(entry: Record<string, unknown>): sessionSearchTypes.SessionHeader | undefined {
  if (entry["type"] !== "session" || typeof entry["id"] !== "string") return undefined;
  return {
    cwd: typeof entry["cwd"] === "string" ? entry["cwd"] : "",
    sessionId: entry["id"],
    startedAt: timeOf(entry["timestamp"]),
  };
}

function scanLine(scan: LineScan, line: string, offset: number, length: number): void {
  const entry = parseSessionEntryLine(line);
  if (!isRecord(entry)) return;
  scan.header ??= headerOf(entry);
  const entryId = typeof entry["id"] === "string" ? entry["id"] : null;
  const at = timeOf(entry["timestamp"]);
  entryParts(entry).forEach((part, index) => {
    if (part.kind === "tool_call" && part.tool !== null && isOrchestratorTool(part.tool)) {
      scan.orchestrator = true;
    }
    if (part.text.trim() === "") return;
    scan.parts.push({
      at,
      body: terms.indexText(part.text),
      entryId,
      kind: part.kind,
      length,
      offset,
      part: index,
      tool: part.tool,
    });
  });
}

function scanLines(bytes: Uint8Array, base: number): LineScan & { end: number } {
  const decoder = new TextDecoder();
  const scan: LineScan = { header: undefined, orchestrator: false, parts: [] };
  let start = 0;
  let newline = bytes.indexOf(NEWLINE, start);
  while (newline !== -1) {
    const line = decoder.decode(bytes.subarray(start, newline));
    scanLine(scan, line, base + start, newline - start);
    start = newline + 1;
    newline = bytes.indexOf(NEWLINE, start);
  }
  return { ...scan, end: base + start };
}

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
  if (known !== undefined && known.indexed > 0 && file.size >= known.indexed) {
    const base = known.indexed - known.tail.length;
    const bytes = yield* readRange(fileSystem, file.path, base, file.size);
    if (sameBytes(bytes.subarray(0, known.tail.length), known.tail)) {
      const window: Window = { base, bytes, from: known.indexed };
      return window;
    }
  }
  const window: Window = {
    base: 0,
    bytes: yield* readRange(fileSystem, file.path, 0, file.size),
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
    failure: undefined,
    from,
    header: scan.header,
    indexed: scan.end,
    mtime: file.mtime,
    orchestrator: scan.orchestrator,
    parts: scan.parts,
    path: file.path,
    size: file.size,
    tail: bytes.slice(Math.max(0, scan.end - TAIL_BYTES - base), scan.end - base),
  };
  return update;
});

const reasonOf = (defect: unknown): string =>
  defect instanceof Error ? `${defect.name}: ${defect.message}` : String(defect);

const skippedUpdate = (file: FoundFile, defect: unknown): sessionSearchTypes.FileUpdate => ({
  failure: reasonOf(defect),
  from: 0,
  header: undefined,
  indexed: 0,
  mtime: file.mtime,
  orchestrator: false,
  parts: [],
  path: file.path,
  size: file.size,
  tail: new Uint8Array(0),
});

const BATCH_BYTES = 8 << 20;

const bodyBytes = (update: sessionSearchTypes.FileUpdate): number =>
  update.parts.reduce((total, part) => total + part.body.length, 0);

const updateWith = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  database: DatabaseSync,
  roots: readonly string[],
  indexPath: string,
) {
  const listed = yield* Effect.forEach([...new Set(roots)], (root) => walk(fileSystem, root, 0));
  const found = new Map(listed.flat().map((file) => [file.path, file]));
  const rows = yield* whileLocked(indexPath, () => indexStore.fileRows(database));
  const known = new Map(rows.map((row) => [row.path, row]));
  const removed = [...known.keys()].filter((path) => !found.has(path) && under(path, roots));
  yield* whileLocked(indexPath, () => indexStore.removeFiles(database, removed));
  const changed = [...found.values()].filter((file) => {
    const row = known.get(file.path);
    return row === undefined || row.size !== file.size || row.mtime !== file.mtime;
  });
  let parts = 0;
  const skipped: sessionSearchTypes.SkippedFile[] = [];
  let batch: sessionSearchTypes.FileUpdate[] = [];
  let batchBytes = 0;
  for (const file of changed) {
    const update = yield* scanFile(fileSystem, file, known.get(file.path)).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.catchDefect((defect) => Effect.succeed(skippedUpdate(file, defect))),
    );
    if (update === undefined) continue;
    if (update.failure !== undefined) skipped.push({ path: file.path, reason: update.failure });
    batch.push(update);
    batchBytes += bodyBytes(update);
    parts += update.parts.length;
    if (batchBytes < BATCH_BYTES) continue;
    const full = batch;
    yield* whileLocked(indexPath, () => indexStore.applyUpdates(database, full));
    batch = [];
    batchBytes = 0;
  }
  const last = batch;
  yield* whileLocked(indexPath, () => indexStore.applyUpdates(database, last));
  const update: sessionSearchTypes.IndexUpdate = {
    changedFiles: changed.length,
    files: found.size,
    parts,
    removedFiles: removed.length,
    skipped,
  };
  return update;
});

const updateIndex = (
  database: DatabaseSync,
  roots: readonly string[],
  indexPath: string,
): Promise<sessionSearchTypes.IndexUpdate> =>
  platformRuntime.runPromise(
    FileSystem.FileSystem.use((fileSystem) => updateWith(fileSystem, database, roots, indexPath)),
  );

const readSlice = (path: string, start: number, end: number): Promise<Uint8Array> =>
  platformRuntime.runPromise(
    FileSystem.FileSystem.use((fileSystem) => readRange(fileSystem, path, start, end)),
  );

const indexer = { readSlice, timeOf, updateIndex };

export default indexer;
