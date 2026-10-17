import { Effect, Predicate, Schema } from "effect";

import type { SinceFilter } from "./auto-since.ts";
import { analyzeEditArguments } from "./edit-replacement.ts";
import type { EditAnalysis } from "./edit-replacement.ts";
import type { HostShape } from "./host.ts";
import {
  collectSessionRecords,
  emptySessionFileCounts,
  forEachDecodedLine,
  messageOf,
} from "./sessions.ts";
import {
  callOriginOf,
  contentBlocks,
  toolCallEntrySchema,
  toolCallIdOf,
  toolCallsOf,
} from "./tool-calls.ts";
import type { Block, CallOrigin } from "./tool-calls.ts";

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

const EntrySchema = toolCallEntrySchema({
  toolName: Schema.optional(Schema.String),
  toolCallId: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
});

type Entry = typeof EntrySchema.Type;
type Message = NonNullable<Entry["message"]>;

interface FileScan {
  readonly host: HostShape;
  readonly meta: EditScanMeta;
  readonly pending: Map<string, EditRecord>;
  readonly records: Array<EditRecord>;
  readonly sessionFile: string;
}

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(EntrySchema));

const textContentOf = (content: Message["content"]): string =>
  Predicate.isString(content)
    ? content
    : contentBlocks(content)
        .flatMap((block) =>
          block["type"] === "text" && Predicate.isString(block["text"]) ? [block["text"]] : [],
        )
        .join("\n");

const ERROR_KINDS: ReadonlyArray<readonly [kind: string, matches: (text: string) => boolean]> = [
  ["file_not_found", (text) => text.includes("file not found")],
  ["not_found_exact_text", (text) => text.includes("could not find the exact text")],
  [
    "multiple_occurrences",
    (text) => text.includes("found multiple occurrences") || MULTIPLE_OCCURRENCES.test(text),
  ],
  ["no_changes_made", (text) => text.includes("no changes made")],
  ["invalid_input", (text) => text.includes("input is invalid")],
  ["overlapping_edits", (text) => text.includes("must not overlap")],
  ["aborted", (text) => text.includes("aborted")],
];

const classifyErrorText = (text: string): string => {
  const normalized = text.toLowerCase();
  return ERROR_KINDS.find(([, matches]) => matches(normalized))?.[0] ?? "other";
};

const errorKindOf = (options: {
  readonly isError: boolean;
  readonly matchedResult: boolean;
  readonly text: string;
}): string | null => {
  if (!options.matchedResult) return "missing_result";
  return options.isError ? classifyErrorText(options.text) : null;
};

const editRecordOf = (origin: CallOrigin, block: Block, host: HostShape): EditRecord => ({
  sessionFile: origin.sessionFile,
  assistantEntryId: origin.assistantEntryId,
  toolCallId: toolCallIdOf(block),
  timestamp: origin.timestamp,
  api: origin.api,
  provider: origin.provider,
  model: origin.model,
  providerModel: origin.providerModel,
  success: null,
  errorKind: null,
  errorText: "",
  resultSummary: "",
  matchedResult: false,
  ...analyzeEditArguments({ args: block["arguments"], host }),
});

const trackEditCalls = (scan: FileScan, entry: Entry, message: Message): void => {
  const origin = callOriginOf({ entry, message, sessionFile: scan.sessionFile });
  for (const block of toolCallsOf({ message, name: "edit" })) {
    const record = editRecordOf(origin, block, scan.host);
    scan.records.push(record);
    if (record.toolCallId !== "") scan.pending.set(record.toolCallId, record);
  }
};

const resolveRecord = (record: EditRecord, message: Message): void => {
  const text = textContentOf(message.content);
  const isError = message.isError === true;
  record.matchedResult = true;
  record.success = !isError;
  record.resultSummary = text;
  record.errorText = isError ? text : "";
  record.errorKind = errorKindOf({ isError, matchedResult: true, text });
};

const applyToolResult = (scan: FileScan, message: Message): void => {
  const toolCallId = message.toolCallId ?? "";
  const record = scan.pending.get(toolCallId);
  if (record === undefined) {
    scan.meta.unmatchedToolResults += 1;
    return;
  }
  resolveRecord(record, message);
  scan.pending.delete(toolCallId);
};

const isEditResult = (message: Message): boolean =>
  message.role === "toolResult" && message.toolName === "edit";

const applyEntry = (scan: FileScan, entry: Entry): void => {
  const message = messageOf(entry);
  if (message === undefined) return;
  trackEditCalls(scan, entry, message);
  if (isEditResult(message)) applyToolResult(scan, message);
};

const markUnresolved = (record: EditRecord): void => {
  record.matchedResult = false;
  record.success = null;
  record.errorKind = errorKindOf({ isError: false, matchedResult: false, text: "" });
};

const scanFile = (options: {
  readonly host: HostShape;
  readonly meta: EditScanMeta;
  readonly sessionFile: string;
}) =>
  Effect.gen(function* () {
    const scan: FileScan = { ...options, pending: new Map(), records: [] };
    yield* forEachDecodedLine({
      decode: decodeEntry,
      file: options.sessionFile,
      host: options.host,
      onEntry: (entry) => applyEntry(scan, entry),
      onMalformed: () => {
        options.meta.malformedLines += 1;
      },
    });
    for (const record of scan.pending.values()) markUnresolved(record);
    if (scan.records.length > 0) options.meta.sessionFilesWithEditCalls += 1;
    return scan.records;
  });

const scanEditCalls = (options: {
  readonly host: HostShape;
  readonly sessionsDir: string;
  readonly since: SinceFilter | null;
}) =>
  Effect.gen(function* () {
    const { host } = options;
    const meta: EditScanMeta = {
      sessionsDir: options.sessionsDir,
      ...emptySessionFileCounts(),
      sessionFilesWithEditCalls: 0,
      since: options.since,
      malformedLines: 0,
      unmatchedToolResults: 0,
    };
    const records = yield* collectSessionRecords({
      ...options,
      counts: meta,
      scanFile: ({ sessionFile }) => scanFile({ host, meta, sessionFile }),
    });
    return { meta, records };
  });

export type { EditRecord, EditScanMeta };
export { scanEditCalls };
