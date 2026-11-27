import { Effect, Predicate, Schema } from "effect";

import editReplacement from "./edit-replacement.ts";
import type editToolScanTypes from "./edit-tool-scan.types.ts";
import type hostTypes from "./host.types.ts";
import type scanOptionsTypes from "./scan-options.types.ts";
import sessions from "./sessions.ts";
import toolCalls from "./tool-calls.ts";
import type toolCallsTypes from "./tool-calls.types.ts";

const { callOriginOf, contentBlocks, toolCallEntrySchema, toolCallIdOf, toolCallsOf } = toolCalls;
const { analyzeEditArguments } = editReplacement;
const { collectSessionRecords, forEachDecodedLine, messageOf, sessionScanMeta } = sessions;

const MULTIPLE_OCCURRENCES = /^found \d+ occurrences/mu;

const EntrySchema = toolCallEntrySchema({
  isError: Schema.optional(Schema.Boolean),
  toolCallId: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
});

type Entry = typeof EntrySchema.Type;
type Message = NonNullable<Entry["message"]>;

interface FileScan {
  readonly host: hostTypes.HostShape;
  readonly meta: editToolScanTypes.EditScanMeta;
  readonly pending: Map<string, editToolScanTypes.EditRecord>;
  readonly records: Array<editToolScanTypes.EditRecord>;
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

const editRecordOf = (
  origin: toolCallsTypes.CallOrigin,
  block: toolCallsTypes.Block,
  host: hostTypes.HostShape,
): editToolScanTypes.EditRecord => ({
  api: origin.api,
  assistantEntryId: origin.assistantEntryId,
  errorKind: null,
  errorText: "",
  matchedResult: false,
  model: origin.model,
  provider: origin.provider,
  providerModel: origin.providerModel,
  resultSummary: "",
  sessionFile: origin.sessionFile,
  success: null,
  timestamp: origin.timestamp,
  toolCallId: toolCallIdOf(block),
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

const resolveRecord = (record: editToolScanTypes.EditRecord, message: Message): void => {
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

const markUnresolved = (record: editToolScanTypes.EditRecord): void => {
  record.matchedResult = false;
  record.success = null;
  record.errorKind = errorKindOf({ isError: false, matchedResult: false, text: "" });
};

const scanFile = (options: {
  readonly host: hostTypes.HostShape;
  readonly meta: editToolScanTypes.EditScanMeta;
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

const scanEditCalls = (options: scanOptionsTypes.SessionScanRequest) =>
  Effect.gen(function* () {
    const { host } = options;
    const meta: editToolScanTypes.EditScanMeta = {
      ...sessionScanMeta(options),
      sessionFilesWithEditCalls: 0,
      unmatchedToolResults: 0,
    };
    const records = yield* collectSessionRecords({
      ...options,
      counts: meta,
      scanFile: ({ sessionFile }) => scanFile({ host, meta, sessionFile }),
    });
    return { meta, records };
  });

const editToolScan = {
  scanEditCalls,
};

export default editToolScan;
