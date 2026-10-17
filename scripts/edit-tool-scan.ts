import { Effect, Predicate, Result, Schema, Stream } from "effect";

import type { SinceFilter } from "./auto-since.ts";
import { analyzeEditArguments } from "./edit-replacement.ts";
import type { EditAnalysis } from "./edit-replacement.ts";
import type { HostShape } from "./host.ts";
import { jsonlFilesRecursive, sessionFileMillis } from "./sessions.ts";

const MULTIPLE_OCCURRENCES = /^found \d+ occurrences/mu;

interface EditRecord extends EditAnalysis {
  readonly sessionFile: string;
  readonly assistantEntryId: string | undefined;
  readonly toolCallId: string;
  readonly timestamp: string | undefined;
  readonly api: string | null;
  readonly provider: string;
  readonly model: string;
  readonly providerModel: string;
  success: boolean | null;
  errorKind: string | null;
  errorText: string;
  resultSummary: string;
  matchedResult: boolean;
}

interface EditScanMeta {
  sessionsDir: string;
  sessionFilesScanned: number;
  sessionFilesIncluded: number;
  sessionFilesSkippedOlderThanSince: number;
  sessionFilesWithEditCalls: number;
  since: SinceFilter | null;
  malformedLines: number;
  unmatchedToolResults: number;
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
      toolName: Schema.optional(Schema.String),
      toolCallId: Schema.optional(Schema.String),
      isError: Schema.optional(Schema.Boolean),
      content: Schema.optional(Schema.Union([Schema.String, Schema.Array(ContentBlock)])),
    }),
  ),
});

type Entry = typeof EntrySchema.Type;
type Message = NonNullable<Entry["message"]>;

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(EntrySchema));

const textContentOf = (content: Message["content"]): string => {
  if (content === undefined) return "";
  if (Predicate.isString(content)) return content;
  return content
    .flatMap((block) =>
      block.type === "text" && Predicate.isString(block.text) ? [block.text] : [],
    )
    .join("\n");
};

const errorKindOf = (options: {
  readonly isError: boolean;
  readonly matchedResult: boolean;
  readonly text: string;
}): string | null => {
  if (!options.matchedResult) return "missing_result";
  if (!options.isError) return null;
  const normalized = options.text.toLowerCase();
  if (normalized.includes("file not found")) return "file_not_found";
  if (normalized.includes("could not find the exact text")) return "not_found_exact_text";
  if (normalized.includes("found multiple occurrences") || MULTIPLE_OCCURRENCES.test(normalized)) {
    return "multiple_occurrences";
  }
  if (normalized.includes("no changes made")) return "no_changes_made";
  if (normalized.includes("input is invalid")) return "invalid_input";
  if (normalized.includes("must not overlap")) return "overlapping_edits";
  if (normalized.includes("aborted")) return "aborted";
  return "other";
};

const editCallRecords = (options: {
  readonly entry: Entry;
  readonly host: HostShape;
  readonly message: Message;
  readonly sessionFile: string;
}): ReadonlyArray<EditRecord> => {
  const { entry, host, message, sessionFile } = options;
  const content = message.content;
  if (message.role !== "assistant" || content === undefined || Predicate.isString(content)) {
    return [];
  }
  const provider = message.provider ?? "[unknown]";
  const model = message.model ?? "[unknown]";
  return content.flatMap((block) => {
    if (block.type !== "toolCall" || block.name !== "edit") return [];
    return [
      {
        sessionFile,
        assistantEntryId: entry.id,
        toolCallId: Predicate.isString(block.id) ? block.id : "",
        timestamp: entry.timestamp,
        api: message.api ?? null,
        provider,
        model,
        providerModel: `${provider}/${model}`,
        success: null,
        errorKind: null,
        errorText: "",
        resultSummary: "",
        matchedResult: false,
        ...analyzeEditArguments({ args: block.arguments, host }),
      },
    ];
  });
};

const applyToolResult = (options: {
  readonly message: Message;
  readonly meta: EditScanMeta;
  readonly pending: Map<string, EditRecord>;
}): void => {
  const { message, meta, pending } = options;
  const toolCallId = message.toolCallId ?? "";
  const record = pending.get(toolCallId);
  if (record === undefined) {
    meta.unmatchedToolResults += 1;
    return;
  }
  const text = textContentOf(message.content);
  const isError = message.isError === true;
  record.matchedResult = true;
  record.success = !isError;
  record.resultSummary = text;
  record.errorText = isError ? text : "";
  record.errorKind = errorKindOf({ isError, matchedResult: true, text });
  pending.delete(toolCallId);
};

const scanFile = (options: {
  readonly host: HostShape;
  readonly meta: EditScanMeta;
  readonly sessionFile: string;
}) =>
  Effect.gen(function* () {
    const { host, meta, sessionFile } = options;
    const records: Array<EditRecord> = [];
    const pending = new Map<string, EditRecord>();
    yield* host.lines(sessionFile).pipe(
      Stream.filter((line) => line.trim() !== ""),
      Stream.runForEach((line) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.result(decodeEntry(line));
          if (!Result.isSuccess(parsed)) {
            meta.malformedLines += 1;
            return;
          }
          const entry = parsed.success;
          const message = entry.message;
          if (entry.type !== "message" || message === undefined) return;
          for (const record of editCallRecords({ entry, host, message, sessionFile })) {
            records.push(record);
            if (record.toolCallId !== "") pending.set(record.toolCallId, record);
          }
          if (message.role === "toolResult" && message.toolName === "edit") {
            applyToolResult({ message, meta, pending });
          }
        }),
      ),
    );
    for (const record of pending.values()) {
      record.matchedResult = false;
      record.success = null;
      record.errorKind = errorKindOf({ isError: false, matchedResult: false, text: "" });
    }
    if (records.length > 0) meta.sessionFilesWithEditCalls += 1;
    return records;
  });

const scanEditCalls = (options: {
  readonly host: HostShape;
  readonly sessionsDir: string;
  readonly since: SinceFilter | null;
}) =>
  Effect.gen(function* () {
    const { host, sessionsDir, since } = options;
    const meta: EditScanMeta = {
      sessionsDir,
      sessionFilesScanned: 0,
      sessionFilesIncluded: 0,
      sessionFilesSkippedOlderThanSince: 0,
      sessionFilesWithEditCalls: 0,
      since,
      malformedLines: 0,
      unmatchedToolResults: 0,
    };
    const records: Array<EditRecord> = [];
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
        records.push(...(yield* scanFile({ host, meta, sessionFile })));
      }),
    );
    return { meta, records };
  });

export type { EditRecord, EditScanMeta };
export { scanEditCalls };
