import { Effect, Predicate, Schema } from "effect";

import type hostTypes from "./host.types.ts";
import type readToolScanTypes from "./read-tool-scan.types.ts";
import type scanOptionsTypes from "./scan-options.types.ts";
import sessions from "./sessions.ts";
import toolCalls from "./tool-calls.ts";
import type toolCallsTypes from "./tool-calls.types.ts";

const { callOriginOf, toolCallEntrySchema, toolCallIdOf, toolCallsOf } = toolCalls;
const { collectSessionRecords, forEachDecodedLine, messageOf, sessionScanMeta, timestampMillis } =
  sessions;

const EntrySchema = toolCallEntrySchema({});

type Entry = typeof EntrySchema.Type;

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(EntrySchema));

const readField = (args: unknown, key: "limit" | "offset" | "path"): unknown =>
  Predicate.hasProperty(key)(args) ? args[key] : undefined;

const readPathOf = (args: unknown): string => {
  const target = readField(args, "path");
  return Predicate.isString(target) ? target : "";
};

const readModeOf = (offset: unknown, limit: unknown): readToolScanTypes.ReadRecord["mode"] =>
  offset === null && limit === null ? "full" : "partial";

const classifyRead = (
  args: unknown,
): Pick<readToolScanTypes.ReadRecord, "limit" | "mode" | "offset" | "path"> => {
  const offset = readField(args, "offset") ?? null;
  const limit = readField(args, "limit") ?? null;
  return { limit, mode: readModeOf(offset, limit), offset, path: readPathOf(args) };
};

const readRecordOf = (
  origin: toolCallsTypes.CallOrigin,
  timestampMs: number,
  block: toolCallsTypes.Block,
): readToolScanTypes.ReadRecord => ({
  api: origin.api,
  assistantEntryId: origin.assistantEntryId,
  model: origin.model,
  provider: origin.provider,
  providerModel: origin.providerModel,
  sessionFile: origin.sessionFile,
  timestamp: origin.timestamp,
  timestampMs,
  toolCallId: toolCallIdOf(block),
  ...classifyRead(block["arguments"]),
});

const readRecords = (options: {
  readonly entry: Entry;
  readonly sessionFile: string;
  readonly sessionMillis: number | null;
}): ReadonlyArray<readToolScanTypes.ReadRecord> => {
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
  readonly host: hostTypes.HostShape;
  readonly meta: readToolScanTypes.ReadScanMeta;
  readonly sessionFile: string;
  readonly sessionMillis: number | null;
}) =>
  Effect.gen(function* () {
    const { host, meta, sessionFile, sessionMillis } = options;
    const records: Array<readToolScanTypes.ReadRecord> = [];
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

const scanReadCalls = (options: scanOptionsTypes.SessionScanRequest) =>
  Effect.gen(function* () {
    const { host } = options;
    const meta: readToolScanTypes.ReadScanMeta = {
      ...sessionScanMeta(options),
      sessionFilesWithReadCalls: 0,
    };
    const records = yield* collectSessionRecords({
      ...options,
      counts: meta,
      scanFile: ({ sessionFile, sessionMillis }) =>
        scanFile({ host, meta, sessionFile, sessionMillis }),
    });
    return { meta, records };
  });

const readToolScan = {
  scanReadCalls,
};

export default readToolScan;
