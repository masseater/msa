import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { idFromNumber } from "../../ids.ts";
import type { DocumentContent, DocumentId, StorageWrite, TaskId } from "../../types.ts";
import type { MemoryStorage } from "../memory.ts";
import { JsonlCorruptionError } from "./corruption-error.ts";
import type { JsonlFiles } from "./files.ts";
import {
  errorFromFile,
  jsonLine,
  type MainMarker,
  type MainOperation,
  type ParsedFile,
  type ParsedLine,
  type SidecarRecord,
  sidecarFileName,
  sidecarKey,
} from "./format.ts";
import { isBeforeLatestBase, type MainAnalysis, type SidecarIndex } from "./recover-scan.ts";

type Replay = {
  readonly analysis: MainAnalysis;
  readonly index: SidecarIndex;
  readonly confirmed: Set<string>;
};

const confirmRecord = (
  replay: Replay,
  marker: MainMarker,
  ordinal: number,
  file: string,
  optional: boolean,
): SidecarRecord | undefined => {
  const key = sidecarKey(file, marker.seq, ordinal);
  if (replay.confirmed.has(key))
    throw new JsonlCorruptionError(`Sidecar record is confirmed more than once`);
  const line = replay.index.recordByKey.get(key);
  if (line === undefined) {
    if (optional) return undefined;
    throw new JsonlCorruptionError(
      `Missing confirmed sidecar record ${file} at sequence ${marker.seq}`,
    );
  }
  replay.confirmed.add(key);
  return line.value;
};

type TaskSidecar = Extract<MainOperation, { type: "task.sidecar" }>;
type DocumentOperation = Extract<MainOperation, { type: "document.create" | "document.change" }>;

const taskWrite = (
  replay: Replay,
  marker: MainMarker,
  operation: TaskSidecar,
): StorageWrite | undefined => {
  const optional = replay.analysis.terminalTasks.has(operation.id);
  const record = confirmRecord(
    replay,
    marker,
    operation.ordinal,
    sidecarFileName("task", operation.id),
    optional,
  );
  if (record === undefined) return undefined;
  if (record.payload.type !== "task" || record.payload.value.id !== operation.id) {
    throw new JsonlCorruptionError(
      `Confirmed task sidecar data does not match commit ${marker.seq}`,
    );
  }
  return optional ? undefined : { type: "task", value: record.payload.value };
};

const documentContent = (
  record: SidecarRecord | undefined,
  id: DocumentId,
  marker: MainMarker,
): DocumentContent | undefined => {
  if (record === undefined) return undefined;
  if (record.payload.type !== "document" || record.payload.id !== id) {
    throw new JsonlCorruptionError(
      `Confirmed document sidecar data does not match commit ${marker.seq}`,
    );
  }
  return record.payload.content;
};

const documentWrite = (
  replay: Replay,
  marker: MainMarker,
  operation: DocumentOperation,
): StorageWrite | undefined => {
  const id = operation.type === "document.create" ? operation.record.id : operation.id;
  const reclaimed =
    replay.analysis.retiredCurrentOnlyDocuments.has(id) ||
    isBeforeLatestBase(replay.analysis, id, marker.seq, operation.ordinal);
  const record = confirmRecord(
    replay,
    marker,
    operation.ordinal,
    sidecarFileName("doc", id),
    reclaimed,
  );
  const content = documentContent(record, id, marker);
  if (operation.type === "document.change") {
    return !reclaimed && content !== undefined
      ? { type: "document.change", id, content }
      : undefined;
  }
  if (content !== undefined && content.kind !== "base") {
    throw new JsonlCorruptionError(
      `Document creation lacks a confirmed base in commit ${marker.seq}`,
    );
  }
  return {
    type: "document.create",
    record: operation.record,
    content: reclaimed || content === undefined ? { kind: "base", version: 1, value: {} } : content,
  };
};

const markerWrites = (replay: Replay, marker: MainMarker): StorageWrite[] => {
  const writes: StorageWrite[] = [];
  for (const operation of marker.writes) {
    const write =
      operation.type === "task.sidecar"
        ? taskWrite(replay, marker, operation)
        : operation.type === "document.create" || operation.type === "document.change"
          ? documentWrite(replay, marker, operation)
          : operation;
    if (write !== undefined) writes.push(write);
  }
  return writes;
};

export const replayMain: {
  (
    analysis: MainAnalysis,
    index: SidecarIndex,
    memory: MemoryStorage,
  ): (main: ParsedFile<MainMarker>) => Set<string>;
  (
    main: ParsedFile<MainMarker>,
    analysis: MainAnalysis,
    index: SidecarIndex,
    memory: MemoryStorage,
  ): Set<string>;
} = Function.dual(
  4,
  (
    main: ParsedFile<MainMarker>,
    analysis: MainAnalysis,
    index: SidecarIndex,
    memory: MemoryStorage,
  ): Set<string> => {
    const replay: Replay = { analysis, index, confirmed: new Set() };
    for (const { value: marker } of main.lines) {
      const writes = markerWrites(replay, marker);
      try {
        memory.prepareCommit(writes, marker.seq).apply();
      } catch (error) {
        throw new JsonlCorruptionError(
          `Invalid committed state at sequence ${marker.seq}`,
          error instanceof Error ? error : undefined,
        );
      }
    }
    return replay.confirmed;
  },
);

const unconfirmedStart = (
  file: string,
  parsed: ParsedFile<SidecarRecord>,
  confirmed: ReadonlySet<string>,
): number | undefined => {
  let unconfirmedAt: number | undefined;
  for (const line of parsed.lines) {
    if (confirmed.has(sidecarKey(file, line.value.seq, line.value.ordinal))) {
      if (unconfirmedAt !== undefined) {
        throw new JsonlCorruptionError(`Confirmed record follows an unconfirmed tail in ${file}`);
      }
    } else if (unconfirmedAt === undefined) {
      unconfirmedAt = line.start;
    }
  }
  return unconfirmedAt;
};

const retainedLinesOf = (
  file: string,
  confirmedLines: readonly ParsedLine<SidecarRecord>[],
  analysis: MainAnalysis,
): readonly ParsedLine<SidecarRecord>[] | undefined => {
  const numericId = Number(file.slice(file.indexOf("-") + 1, -".jsonl".length));
  if (file.startsWith("task-"))
    return analysis.terminalTasks.has(idFromNumber<TaskId>(numericId)) ? [] : undefined;
  if (!file.startsWith("doc-")) return undefined;
  const documentId = idFromNumber<DocumentId>(numericId);
  if (analysis.retiredCurrentOnlyDocuments.has(documentId)) return [];
  if (!analysis.latestBases.has(documentId)) return undefined;
  return confirmedLines.filter(
    (line) => !isBeforeLatestBase(analysis, documentId, line.value.seq, line.value.ordinal),
  );
};

const settleSidecar = Effect.fnUntraced(function* (
  files: JsonlFiles,
  file: string,
  parsed: ParsedFile<SidecarRecord>,
  confirmed: ReadonlySet<string>,
  context: Context,
) {
  const unconfirmedAt = unconfirmedStart(file, parsed, confirmed);
  if (unconfirmedAt !== undefined) {
    const truncated = yield* Effect.promise(() =>
      files.fs.truncateFile(parsed.path, unconfirmedAt, context),
    );
    if (!truncated.ok) throw errorFromFile(`tail truncation of ${file}`, truncated.error);
  }
  return parsed.lines.filter((line) =>
    confirmed.has(sidecarKey(file, line.value.seq, line.value.ordinal)),
  );
});

export const settleSidecars: {
  (
    index: SidecarIndex,
    analysis: MainAnalysis,
    confirmed: ReadonlySet<string>,
    context: Context,
  ): (files: JsonlFiles) => Effect.Effect<ReadonlyMap<string, string>>;
  (
    files: JsonlFiles,
    index: SidecarIndex,
    analysis: MainAnalysis,
    confirmed: ReadonlySet<string>,
    context: Context,
  ): Effect.Effect<ReadonlyMap<string, string>>;
} = Function.dual(
  5,
  Effect.fnUntraced(function* (
    files: JsonlFiles,
    index: SidecarIndex,
    analysis: MainAnalysis,
    confirmed: ReadonlySet<string>,
    context: Context,
  ) {
    const reclamations = new Map<string, string>();
    for (const [file, parsed] of index.parsedFiles) {
      const confirmedLines = yield* settleSidecar(files, file, parsed, confirmed, context);
      const retainedLines = retainedLinesOf(file, confirmedLines, analysis);
      if (
        retainedLines !== undefined &&
        (retainedLines.length < confirmedLines.length || retainedLines.length === 0)
      ) {
        reclamations.set(file, retainedLines.map((line) => jsonLine(line.value)).join(""));
      }
    }
    return reclamations;
  }),
);
