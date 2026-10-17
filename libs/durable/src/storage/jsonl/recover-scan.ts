import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import type { FileInfo } from "../../env/index.ts";
import type { DocumentId, Seq, TaskId } from "../../types.ts";
import { JsonlCorruptionError } from "./corruption-error.ts";
import { type JsonlFiles, readLines } from "./files.ts";
import {
  errorFromFile,
  isCurrentOnly,
  isReclaimFileName,
  isSidecarFileName,
  MAIN_FILE,
  type MainMarker,
  type ParsedFile,
  type ParsedLine,
  parseMainMarker,
  parseSidecarRecord,
  type SidecarRecord,
  sidecarFileName,
  sidecarKey,
} from "./format.ts";

export type SidecarIndex = {
  readonly parsedFiles: Map<string, ParsedFile<SidecarRecord>>;
  readonly recordByKey: Map<string, ParsedLine<SidecarRecord>>;
};

export type MainAnalysis = {
  readonly currentOnlyDocuments: ReadonlySet<DocumentId>;
  readonly retiredCurrentOnlyDocuments: ReadonlySet<DocumentId>;
  readonly finalTaskIsLive: ReadonlyMap<TaskId, boolean>;
  readonly terminalTasks: ReadonlySet<TaskId>;
  readonly latestBases: ReadonlyMap<DocumentId, SidecarRecord>;
};

export const readMain = Effect.fnUntraced(function* (files: JsonlFiles, context: Context) {
  const main = yield* readLines(files.fs, files.mainPath, MAIN_FILE, context, (text, line) =>
    parseMainMarker(text, line),
  );
  let previousSeq = 0;
  for (const marker of main.lines) {
    if (marker.value.seq <= previousSeq) {
      throw new JsonlCorruptionError(`Commit sequence does not strictly increase in ${MAIN_FILE}`);
    }
    previousSeq = marker.value.seq;
  }
  return main;
});

const removeReclaimFiles = (files: JsonlFiles, listed: readonly FileInfo[], context: Context) =>
  Effect.forEach(
    listed.filter((info) => info.kind === "file" && isReclaimFileName(info.name)),
    (info) => Effect.promise(() => files.fs.remove(info.path, { force: true }, context)),
    { discard: true },
  );

const checkOrder = (file: string, lines: readonly ParsedLine<SidecarRecord>[]): void => {
  let previous: SidecarRecord | undefined;
  for (const line of lines) {
    if (
      previous !== undefined &&
      (line.value.seq < previous.seq ||
        (line.value.seq === previous.seq && line.value.ordinal <= previous.ordinal))
    ) {
      throw new JsonlCorruptionError(`Sidecar records are out of order in ${file}`);
    }
    previous = line.value;
  }
};

const readSidecar = Effect.fnUntraced(function* (
  files: JsonlFiles,
  file: string,
  context: Context,
) {
  const pathResult = yield* Effect.promise(() =>
    files.fs.joinPath([files.directory, file], context),
  );
  if (!pathResult.ok) throw errorFromFile("path join", pathResult.error);
  return yield* readLines(files.fs, pathResult.value, file, context, (text, line) =>
    parseSidecarRecord(text, file, line),
  );
});

export const readSidecars = Effect.fnUntraced(function* (files: JsonlFiles, context: Context) {
  const listed = yield* Effect.promise(() => files.fs.listDir(files.directory, context));
  if (!listed.ok) throw errorFromFile("directory listing", listed.error);
  yield* removeReclaimFiles(files, listed.value, context);
  const sidecarFiles = listed.value
    .filter((info) => info.kind === "file" && isSidecarFileName(info.name))
    .map((info) => info.name)
    .sort();
  const index: SidecarIndex = { parsedFiles: new Map(), recordByKey: new Map() };
  yield* Effect.forEach(
    sidecarFiles,
    (file) =>
      Effect.map(readSidecar(files, file, context), (parsed) => {
        index.parsedFiles.set(file, parsed);
        checkOrder(file, parsed.lines);
        for (const line of parsed.lines) {
          index.recordByKey.set(sidecarKey(file, line.value.seq, line.value.ordinal), line);
        }
      }),
    { discard: true },
  );
  return index;
});

const operationFacts = (main: ParsedFile<MainMarker>) => {
  const currentOnlyDocuments = new Set<DocumentId>();
  const retiredDocuments = new Set<DocumentId>();
  const finalTaskIsLive = new Map<TaskId, boolean>();
  for (const { value: marker } of main.lines) {
    for (const operation of marker.writes) {
      if (operation.type === "document.create") {
        if (isCurrentOnly(operation.record)) currentOnlyDocuments.add(operation.record.id);
      } else if (operation.type === "document.retire") {
        retiredDocuments.add(operation.id);
      } else if (operation.type === "task") {
        finalTaskIsLive.set(operation.value.id, false);
      } else if (operation.type === "task.sidecar") {
        finalTaskIsLive.set(operation.id, true);
      }
    }
  }
  return { currentOnlyDocuments, retiredDocuments, finalTaskIsLive };
};

const isNewerBase = (record: SidecarRecord, previous: SidecarRecord | undefined): boolean =>
  previous === undefined ||
  record.seq > previous.seq ||
  (record.seq === previous.seq && record.ordinal > previous.ordinal);

const baseRecord = (
  recordByKey: ReadonlyMap<string, ParsedLine<SidecarRecord>>,
  id: DocumentId,
  seq: Seq,
  ordinal: number,
): SidecarRecord | undefined => {
  const record = recordByKey.get(sidecarKey(sidecarFileName("doc", id), seq, ordinal))?.value;
  return record?.payload.type === "document" &&
    record.payload.id === id &&
    record.payload.content.kind === "base"
    ? record
    : undefined;
};

const findLatestBases = (
  main: ParsedFile<MainMarker>,
  currentOnlyDocuments: ReadonlySet<DocumentId>,
  recordByKey: ReadonlyMap<string, ParsedLine<SidecarRecord>>,
): Map<DocumentId, SidecarRecord> => {
  const latestBases = new Map<DocumentId, SidecarRecord>();
  for (const { value: marker } of main.lines) {
    for (const operation of marker.writes) {
      if (operation.type !== "document.create" && operation.type !== "document.change") continue;
      const id = operation.type === "document.create" ? operation.record.id : operation.id;
      if (!currentOnlyDocuments.has(id)) continue;
      const record = baseRecord(recordByKey, id, marker.seq, operation.ordinal);
      if (record !== undefined && isNewerBase(record, latestBases.get(id)))
        latestBases.set(id, record);
    }
  }
  return latestBases;
};

export const analyzeMain: {
  (index: SidecarIndex): (main: ParsedFile<MainMarker>) => MainAnalysis;
  (main: ParsedFile<MainMarker>, index: SidecarIndex): MainAnalysis;
} = Function.dual(2, (main: ParsedFile<MainMarker>, index: SidecarIndex): MainAnalysis => {
  const { currentOnlyDocuments, retiredDocuments, finalTaskIsLive } = operationFacts(main);
  return {
    currentOnlyDocuments,
    retiredCurrentOnlyDocuments: new Set(
      [...retiredDocuments].filter((id) => currentOnlyDocuments.has(id)),
    ),
    finalTaskIsLive,
    terminalTasks: new Set([...finalTaskIsLive].filter(([, live]) => !live).map(([id]) => id)),
    latestBases: findLatestBases(main, currentOnlyDocuments, index.recordByKey),
  };
});

export const isBeforeLatestBase: {
  (id: DocumentId, seq: Seq, ordinal: number): (analysis: MainAnalysis) => boolean;
  (analysis: MainAnalysis, id: DocumentId, seq: Seq, ordinal: number): boolean;
} = Function.dual(
  4,
  (analysis: MainAnalysis, id: DocumentId, seq: Seq, ordinal: number): boolean => {
    const base = analysis.latestBases.get(id);
    return base !== undefined && (seq < base.seq || (seq === base.seq && ordinal < base.ordinal));
  },
);
