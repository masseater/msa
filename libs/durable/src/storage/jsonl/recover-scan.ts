import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import type envTypes from "../../env/index.types.ts";
import type typesModule from "../../types.types.ts";
import JsonlCorruptionError from "./corruption-error.ts";
import filesModule from "./files.ts";
import type filesTypes from "./files.types.ts";
import formatModule from "./format.ts";
import type formatTypes from "./format.types.ts";
import type recoverScanTypes from "./recover-scan.types.ts";

const { readLines } = filesModule;
const {
  MAIN_FILE,
  errorFromFile,
  isCurrentOnly,
  isReclaimFileName,
  isSidecarFileName,
  parseMainMarker,
  parseSidecarRecord,
  sidecarFileName,
  sidecarKey,
} = formatModule;

const readMain = Effect.fnUntraced(function* (
  files: filesTypes.JsonlFiles,
  context: chordTypes.Context,
) {
  const main = yield* readLines(files.fs, files.mainPath, MAIN_FILE, context, (text, line) =>
    parseMainMarker(text, line),
  );
  let previousSeq = 0;
  for (const marker of main.lines) {
    if (marker.value.seq <= previousSeq) {
      throw JsonlCorruptionError.create(
        `Commit sequence does not strictly increase in ${MAIN_FILE}`,
      );
    }
    previousSeq = marker.value.seq;
  }
  return main;
});

const removeReclaimFiles = (
  files: filesTypes.JsonlFiles,
  listed: readonly envTypes.FileInfo[],
  context: chordTypes.Context,
) =>
  Effect.forEach(
    listed.filter((info) => info.kind === "file" && isReclaimFileName(info.name)),
    (info) => Effect.promise(() => files.fs.remove(info.path, { force: true }, context)),
    { discard: true },
  );

const checkOrder = (
  file: string,
  lines: readonly formatTypes.ParsedLine<formatTypes.SidecarRecord>[],
): void => {
  let previous: formatTypes.SidecarRecord | undefined;
  for (const line of lines) {
    if (
      previous !== undefined &&
      (line.value.seq < previous.seq ||
        (line.value.seq === previous.seq && line.value.ordinal <= previous.ordinal))
    ) {
      throw JsonlCorruptionError.create(`Sidecar records are out of order in ${file}`);
    }
    previous = line.value;
  }
};

const readSidecar = Effect.fnUntraced(function* (
  files: filesTypes.JsonlFiles,
  file: string,
  context: chordTypes.Context,
) {
  const pathResult = yield* Effect.promise(() =>
    files.fs.joinPath([files.directory, file], context),
  );
  if (!pathResult.ok) throw errorFromFile("path join", pathResult.error);
  return yield* readLines(files.fs, pathResult.value, file, context, (text, line) =>
    parseSidecarRecord(text, file, line),
  );
});

const readSidecars = Effect.fnUntraced(function* (
  files: filesTypes.JsonlFiles,
  context: chordTypes.Context,
) {
  const listed = yield* Effect.promise(() => files.fs.listDir(files.directory, context));
  if (!listed.ok) throw errorFromFile("directory listing", listed.error);
  yield* removeReclaimFiles(files, listed.value, context);
  const sidecarFiles = listed.value
    .filter((info) => info.kind === "file" && isSidecarFileName(info.name))
    .map((info) => info.name)
    .sort();
  const index: recoverScanTypes.SidecarIndex = { parsedFiles: new Map(), recordByKey: new Map() };
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

const operationFacts = (main: formatTypes.ParsedFile<formatTypes.MainMarker>) => {
  const currentOnlyDocuments = new Set<typesModule.DocumentId>();
  const retiredDocuments = new Set<typesModule.DocumentId>();
  const finalTaskIsLive = new Map<typesModule.TaskId, boolean>();
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
  return { currentOnlyDocuments, finalTaskIsLive, retiredDocuments };
};

const isNewerBase = (
  record: formatTypes.SidecarRecord,
  previous: formatTypes.SidecarRecord | undefined,
): boolean =>
  previous === undefined ||
  record.seq > previous.seq ||
  (record.seq === previous.seq && record.ordinal > previous.ordinal);

const baseRecord = (
  recordByKey: ReadonlyMap<string, formatTypes.ParsedLine<formatTypes.SidecarRecord>>,
  id: typesModule.DocumentId,
  seq: typesModule.Seq,
  ordinal: number,
): formatTypes.SidecarRecord | undefined => {
  const record = recordByKey.get(sidecarKey(sidecarFileName("doc", id), seq, ordinal))?.value;
  return record?.payload.type === "document" &&
    record.payload.id === id &&
    record.payload.content.kind === "base"
    ? record
    : undefined;
};

const findLatestBases = (
  main: formatTypes.ParsedFile<formatTypes.MainMarker>,
  currentOnlyDocuments: ReadonlySet<typesModule.DocumentId>,
  recordByKey: ReadonlyMap<string, formatTypes.ParsedLine<formatTypes.SidecarRecord>>,
): Map<typesModule.DocumentId, formatTypes.SidecarRecord> => {
  const latestBases = new Map<typesModule.DocumentId, formatTypes.SidecarRecord>();
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

const analyzeMain: {
  (
    index: recoverScanTypes.SidecarIndex,
  ): (main: formatTypes.ParsedFile<formatTypes.MainMarker>) => recoverScanTypes.MainAnalysis;
  (
    main: formatTypes.ParsedFile<formatTypes.MainMarker>,
    index: recoverScanTypes.SidecarIndex,
  ): recoverScanTypes.MainAnalysis;
} = Function.dual(
  2,
  (
    main: formatTypes.ParsedFile<formatTypes.MainMarker>,
    index: recoverScanTypes.SidecarIndex,
  ): recoverScanTypes.MainAnalysis => {
    const { currentOnlyDocuments, retiredDocuments, finalTaskIsLive } = operationFacts(main);
    return {
      currentOnlyDocuments,
      finalTaskIsLive,
      latestBases: findLatestBases(main, currentOnlyDocuments, index.recordByKey),
      retiredCurrentOnlyDocuments: new Set(
        [...retiredDocuments].filter((id) => currentOnlyDocuments.has(id)),
      ),
      terminalTasks: new Set([...finalTaskIsLive].filter(([, live]) => !live).map(([id]) => id)),
    };
  },
);

const isBeforeLatestBase: {
  (
    id: typesModule.DocumentId,
    seq: typesModule.Seq,
    ordinal: number,
  ): (analysis: recoverScanTypes.MainAnalysis) => boolean;
  (
    analysis: recoverScanTypes.MainAnalysis,
    id: typesModule.DocumentId,
    seq: typesModule.Seq,
    ordinal: number,
  ): boolean;
} = Function.dual(
  4,
  (
    analysis: recoverScanTypes.MainAnalysis,
    id: typesModule.DocumentId,
    seq: typesModule.Seq,
    ordinal: number,
  ): boolean => {
    const base = analysis.latestBases.get(id);
    return base !== undefined && (seq < base.seq || (seq === base.seq && ordinal < base.ordinal));
  },
);

const recoverScan = {
  analyzeMain,
  isBeforeLatestBase,
  readMain,
  readSidecars,
};

export default recoverScan;
