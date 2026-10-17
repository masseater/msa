import { Effect, Predicate, Result, Schema, Stream } from "effect";

import type { SinceFilter } from "./auto-since.ts";
import type { HostShape } from "./host.ts";
import { jsonlFilesRecursive, parseMillis, sessionFileMillis } from "./sessions.ts";

type ReadMode = "full" | "partial";

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
  readonly mode: ReadMode;
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

const ContentBlock = Schema.Record(Schema.String, Schema.Unknown);

const EntrySchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  message: Schema.optional(
    Schema.Struct({
      role: Schema.optional(Schema.String),
      api: Schema.optional(Schema.String),
      provider: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      content: Schema.optional(Schema.Union([Schema.String, Schema.Array(ContentBlock)])),
    }),
  ),
});

type Entry = typeof EntrySchema.Type;

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(EntrySchema));

const readField = (args: unknown, key: "limit" | "offset" | "path"): unknown =>
  Predicate.hasProperty(key)(args) ? args[key] : undefined;

const classifyRead = (
  args: unknown,
): {
  readonly path: string;
  readonly offset: unknown;
  readonly limit: unknown;
  readonly mode: ReadMode;
} => {
  const offset = readField(args, "offset");
  const limit = readField(args, "limit");
  const target = readField(args, "path");
  const hasOffset = offset !== undefined && offset !== null;
  const hasLimit = limit !== undefined && limit !== null;
  return {
    path: Predicate.isString(target) ? target : "",
    offset: hasOffset ? offset : null,
    limit: hasLimit ? limit : null,
    mode: hasOffset || hasLimit ? "partial" : "full",
  };
};

const readRecords = (options: {
  readonly entry: Entry;
  readonly sessionFile: string;
  readonly sessionMillis: number | null;
}): ReadonlyArray<ReadRecord> => {
  const { entry, sessionFile, sessionMillis } = options;
  const message = entry.message;
  if (entry.type !== "message" || message === undefined) return [];
  const content = message.content;
  if (message.role !== "assistant" || content === undefined || Predicate.isString(content)) {
    return [];
  }
  const provider = message.provider ?? "[unknown]";
  const model = message.model ?? "[unknown]";
  const entryMillis = entry.timestamp === undefined ? null : parseMillis(entry.timestamp);
  return content.flatMap((block) => {
    if (block["type"] !== "toolCall" || block["name"] !== "read") return [];
    return [
      {
        sessionFile,
        assistantEntryId: entry.id,
        toolCallId: Predicate.isString(block["id"]) ? block["id"] : "",
        timestamp: entry.timestamp,
        timestampMs: entryMillis ?? sessionMillis ?? 0,
        api: message.api ?? null,
        provider,
        model,
        providerModel: `${provider}/${model}`,
        ...classifyRead(block["arguments"]),
      },
    ];
  });
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
    yield* host.lines(sessionFile).pipe(
      Stream.filter((line) => line.trim() !== ""),
      Stream.runForEach((line) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.result(decodeEntry(line));
          if (!Result.isSuccess(parsed)) {
            meta.malformedLines += 1;
            return;
          }
          records.push(...readRecords({ entry: parsed.success, sessionFile, sessionMillis }));
        }),
      ),
    );
    if (records.length > 0) meta.sessionFilesWithReadCalls += 1;
    return records;
  });

const scanReadCalls = (options: {
  readonly host: HostShape;
  readonly sessionsDir: string;
  readonly since: SinceFilter | null;
}) =>
  Effect.gen(function* () {
    const { host, sessionsDir, since } = options;
    const meta: ReadScanMeta = {
      sessionsDir,
      sessionFilesScanned: 0,
      sessionFilesIncluded: 0,
      sessionFilesSkippedOlderThanSince: 0,
      sessionFilesWithReadCalls: 0,
      since,
      malformedLines: 0,
    };
    const records: Array<ReadRecord> = [];
    const files = yield* jsonlFilesRecursive({ directory: sessionsDir, host });
    yield* Effect.forEach(files, (sessionFile) =>
      Effect.gen(function* () {
        meta.sessionFilesScanned += 1;
        const sessionMillis = sessionFileMillis({ file: sessionFile, host });
        if (since !== null && sessionMillis !== null && sessionMillis < since.ms) {
          meta.sessionFilesSkippedOlderThanSince += 1;
          return;
        }
        meta.sessionFilesIncluded += 1;
        records.push(...(yield* scanFile({ host, meta, sessionFile, sessionMillis })));
      }),
    );
    return { meta, records };
  });

export type { ReadRecord, ReadScanMeta };
export { scanReadCalls };
