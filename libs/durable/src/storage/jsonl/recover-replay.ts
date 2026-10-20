import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import ids from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import JsonlCorruptionError from "./corruption-error.ts";
import formatModule from "./format.ts";
import type formatTypes from "./format.types.ts";
import type recoverReplayTypes from "./recover-replay.types.ts";
import recoverScan from "./recover-scan.ts";
import type recoverScanTypes from "./recover-scan.types.ts";

const { errorFromFile, jsonLine, sidecarFileName, sidecarKey } = formatModule;

const { isBeforeLatestBase } = recoverScan;
const { idFromNumber } = ids;

type Replay = {
  readonly analysis: recoverScanTypes.MainAnalysis;
  readonly index: recoverScanTypes.SidecarIndex;
  readonly confirmed: Set<string>;
};

const confirmRecord = (
  replay: Replay,
  marker: formatTypes.MainMarker,
  ordinal: number,
  file: string,
  optional: boolean,
): formatTypes.SidecarRecord | undefined => {
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

type TaskSidecar = Extract<formatTypes.MainOperation, { type: "task.sidecar" }>;
type DocumentOperation = Extract<
  formatTypes.MainOperation,
  { type: "document.create" | "document.change" }
>;

const taskWrite = (
  replay: Replay,
  marker: formatTypes.MainMarker,
  operation: TaskSidecar,
): typesModule.StorageWrite | undefined => {
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
  record: formatTypes.SidecarRecord | undefined,
  id: typesModule.DocumentId,
  marker: formatTypes.MainMarker,
): typesModule.DocumentContent | undefined => {
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
  marker: formatTypes.MainMarker,
  operation: DocumentOperation,
): typesModule.StorageWrite | undefined => {
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
      ? { content, id, type: "document.change" }
      : undefined;
  }
  if (content !== undefined && content.kind !== "base") {
    throw new JsonlCorruptionError(
      `Document creation lacks a confirmed base in commit ${marker.seq}`,
    );
  }
  return {
    content: reclaimed || content === undefined ? { kind: "base", value: {}, version: 1 } : content,
    record: operation.record,
    type: "document.create",
  };
};

const markerWrites = (
  replay: Replay,
  marker: formatTypes.MainMarker,
): typesModule.StorageWrite[] => {
  const writes: typesModule.StorageWrite[] = [];
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

const replayMain: {
  (
    analysis: recoverScanTypes.MainAnalysis,
    index: recoverScanTypes.SidecarIndex,
    memory: recoverReplayTypes.MemoryStorage,
  ): (main: formatTypes.ParsedFile<formatTypes.MainMarker>) => Set<string>;
  (
    main: formatTypes.ParsedFile<formatTypes.MainMarker>,
    analysis: recoverScanTypes.MainAnalysis,
    index: recoverScanTypes.SidecarIndex,
    memory: recoverReplayTypes.MemoryStorage,
  ): Set<string>;
} = Function.dual(
  4,
  (
    main: formatTypes.ParsedFile<formatTypes.MainMarker>,
    analysis: recoverScanTypes.MainAnalysis,
    index: recoverScanTypes.SidecarIndex,
    memory: recoverReplayTypes.MemoryStorage,
  ): Set<string> => {
    const replay: Replay = { analysis, confirmed: new Set(), index };
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
  parsed: formatTypes.ParsedFile<formatTypes.SidecarRecord>,
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
  confirmedLines: readonly formatTypes.ParsedLine<formatTypes.SidecarRecord>[],
  analysis: recoverScanTypes.MainAnalysis,
): readonly formatTypes.ParsedLine<formatTypes.SidecarRecord>[] | undefined => {
  const numericId = Number(file.slice(file.indexOf("-") + 1, -".jsonl".length));
  if (file.startsWith("task-"))
    return analysis.terminalTasks.has(idFromNumber<typesModule.TaskId>(numericId)) ? [] : undefined;
  if (!file.startsWith("doc-")) return undefined;
  const documentId = idFromNumber<typesModule.DocumentId>(numericId);
  if (analysis.retiredCurrentOnlyDocuments.has(documentId)) return [];
  if (!analysis.latestBases.has(documentId)) return undefined;
  return confirmedLines.filter(
    (line) => !isBeforeLatestBase(analysis, documentId, line.value.seq, line.value.ordinal),
  );
};

const settleSidecar = Effect.fnUntraced(function* (
  files: recoverReplayTypes.JsonlFiles,
  file: string,
  parsed: formatTypes.ParsedFile<formatTypes.SidecarRecord>,
  confirmed: ReadonlySet<string>,
  context: chordTypes.Context,
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

const settleSidecars: {
  (
    index: recoverScanTypes.SidecarIndex,
    analysis: recoverScanTypes.MainAnalysis,
    confirmed: ReadonlySet<string>,
    context: chordTypes.Context,
  ): (files: recoverReplayTypes.JsonlFiles) => Effect.Effect<ReadonlyMap<string, string>>;
  (
    files: recoverReplayTypes.JsonlFiles,
    index: recoverScanTypes.SidecarIndex,
    analysis: recoverScanTypes.MainAnalysis,
    confirmed: ReadonlySet<string>,
    context: chordTypes.Context,
  ): Effect.Effect<ReadonlyMap<string, string>>;
} = Function.dual(
  5,
  Effect.fnUntraced(function* (
    files: recoverReplayTypes.JsonlFiles,
    index: recoverScanTypes.SidecarIndex,
    analysis: recoverScanTypes.MainAnalysis,
    confirmed: ReadonlySet<string>,
    context: chordTypes.Context,
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

const recoverReplay = {
  replayMain,
  settleSidecars,
};

export default recoverReplay;
