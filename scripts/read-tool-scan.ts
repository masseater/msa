import { Effect, Predicate, Schema } from "effect";

import type { SinceFilter } from "./auto-since.ts";
import type { HostShape } from "./host.ts";
import {
  collectSessionRecords,
  emptySessionFileCounts,
  forEachDecodedLine,
  messageOf,
  timestampMillis,
} from "./sessions.ts";
import { callOriginOf, toolCallEntrySchema, toolCallIdOf, toolCallsOf } from "./tool-calls.ts";
import type { Block, CallOrigin } from "./tool-calls.ts";

interface ReadRecord {
  readonly sessionFile: string;
  readonly assistantEntryId: string | undefined;
  readonly toolCallId: string;
  readonly timestamp: string | undefined;
  readonly timestampMs: number;
  readonly api: string | null;
  readonly provider: string;
  readonly model: string;
  readonly providerModel: string;
  readonly path: string;
  readonly offset: unknown;
  readonly limit: unknown;
  readonly mode: "full" | "partial";
}

interface ReadScanMeta {
  sessionsDir: string;
  sessionFilesScanned: number;
  sessionFilesIncluded: number;
  sessionFilesSkippedOlderThanSince: number;
  sessionFilesWithReadCalls: number;
  since: SinceFilter | null;
  malformedLines: number;
}

const EntrySchema = toolCallEntrySchema({});

type Entry = typeof EntrySchema.Type;

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(EntrySchema));

const readField = (args: unknown, key: "limit" | "offset" | "path"): unknown =>
  Predicate.hasProperty(key)(args) ? args[key] : undefined;

const readPathOf = (args: unknown): string => {
  const target = readField(args, "path");
  return Predicate.isString(target) ? target : "";
};

const readModeOf = (offset: unknown, limit: unknown): ReadRecord["mode"] =>
  offset === null && limit === null ? "full" : "partial";

const classifyRead = (args: unknown): Pick<ReadRecord, "limit" | "mode" | "offset" | "path"> => {
  const offset = readField(args, "offset") ?? null;
  const limit = readField(args, "limit") ?? null;
  return { path: readPathOf(args), offset, limit, mode: readModeOf(offset, limit) };
};

const readRecordOf = (origin: CallOrigin, timestampMs: number, block: Block): ReadRecord => ({
  sessionFile: origin.sessionFile,
  assistantEntryId: origin.assistantEntryId,
  toolCallId: toolCallIdOf(block),
  timestamp: origin.timestamp,
  timestampMs,
  api: origin.api,
  provider: origin.provider,
  model: origin.model,
  providerModel: origin.providerModel,
  ...classifyRead(block["arguments"]),
});

const readRecords = (options: {
  readonly entry: Entry;
  readonly sessionFile: string;
  readonly sessionMillis: number | null;
}): ReadonlyArray<ReadRecord> => {
  const { entry, sessionFile } = options;
  const message = messageOf(entry);
  if (message === undefined) return [];
  const origin = callOriginOf({ entry, message, sessionFile });
  const timestampMs = timestampMillis(entry.timestamp) ?? options.sessionMillis ?? 0;
  return toolCallsOf({ message, name: "read" }).map((block) =>
    readRecordOf(origin, timestampMs, block),
  );
};

const scanFile = (options: {
  readonly host: HostShape;
  readonly meta: ReadScanMeta;
  readonly sessionFile: string;
  readonly sessionMillis: number | null;
}) =>
  Effect.gen(function* () {
    const { host, meta, sessionFile, sessionMillis } = options;
    const records: Array<ReadRecord> = [];
    yield* forEachDecodedLine({
      decode: decodeEntry,
      file: sessionFile,
      host,
      onEntry: (entry) => {
        records.push(...readRecords({ entry, sessionFile, sessionMillis }));
      },
      onMalformed: () => {
        meta.malformedLines += 1;
      },
    });
    if (records.length > 0) meta.sessionFilesWithReadCalls += 1;
    return records;
  });

const scanReadCalls = (options: {
  readonly host: HostShape;
  readonly sessionsDir: string;
  readonly since: SinceFilter | null;
}) =>
  Effect.gen(function* () {
    const { host } = options;
    const meta: ReadScanMeta = {
      sessionsDir: options.sessionsDir,
      ...emptySessionFileCounts(),
      sessionFilesWithReadCalls: 0,
      since: options.since,
      malformedLines: 0,
    };
    const records = yield* collectSessionRecords({
      ...options,
      counts: meta,
      scanFile: ({ sessionFile, sessionMillis }) =>
        scanFile({ host, meta, sessionFile, sessionMillis }),
    });
    return { meta, records };
  });

export type { ReadRecord, ReadScanMeta };
export { scanReadCalls };
