import type { Context } from "@msa/chord";
import { characterEnd } from "@msa/chord/output";
import { Effect, Function } from "effect";

import decodeModule from "../env/decode.ts";
import type envTypes from "../env/index.types.ts";
import resultModule from "../env/result.ts";
import type typesModule from "../harness/types.types.ts";
import truncate from "../truncate.ts";
import type truncateTypes from "../truncate.types.ts";
import type readTextTypes from "./read-text.types.ts";

const { rangeDecoder, startsWithBom } = decodeModule;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHeadOf, utf8ByteLength } =
  truncate;
const { getOrThrow } = resultModule;

const READ_CHUNK = 64 * 1024;

const sliceIndex = (value: number): number => (Number.isNaN(value) ? 0 : Math.trunc(value));

const readHead = Effect.fnUntraced(function* (
  source: readTextTypes.BinarySource,
  scan: envTypes.LineScan,
  skipBom: boolean,
) {
  const decoder = rangeDecoder();
  let text = "";
  let newlines = 0;
  let position = skipBom && scan.start === 0 ? 3 : scan.start;
  while (position < scan.end) {
    const bytes = yield* source.read(position, Math.min(READ_CHUNK, scan.end - position));
    if (bytes.length === 0) break;
    const decoded = decoder.decode(bytes, { stream: true });
    text += decoded;
    for (let index = decoded.indexOf("\n"); index !== -1; index = decoded.indexOf("\n", index + 1))
      newlines++;
    if (newlines >= DEFAULT_MAX_LINES || utf8ByteLength(text) > DEFAULT_MAX_BYTES + 1) return text;
    position += bytes.length;
  }
  return text + decoder.decode();
});

type Selection = {
  readonly scan: envTypes.LineScan;
  readonly startLine: number;
  readonly totalFileLines: number;
  readonly selectedLineCount: number;
  readonly userLimitedLines: number | undefined;
};

const selectLines = Effect.fnUntraced(function* (
  source: readTextTypes.BinarySource,
  offset: number | undefined,
  limit: number | undefined,
) {
  const startLine =
    offset === undefined || offset === 0 || Number.isNaN(offset) ? 0 : Math.max(0, offset - 1);
  const sliceStart = sliceIndex(startLine);
  const scanStart = Number.isSafeInteger(sliceStart) ? sliceStart : 0;
  const requestedEnd =
    limit === undefined ? undefined : Math.max(scanStart + 1, sliceIndex(startLine + limit));
  const scanOf = (endLine: number | undefined): Effect.Effect<envTypes.LineScan> =>
    source.scanLines({ startLine: scanStart, ...(endLine === undefined ? {} : { endLine }) });
  let scan = yield* scanOf(
    requestedEnd !== undefined && Number.isSafeInteger(requestedEnd) ? requestedEnd : undefined,
  );
  const totalFileLines = scan.newlines + 1;
  if (startLine >= totalFileLines) {
    throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
  }
  if (limit === undefined) {
    const selection: Selection = {
      scan,
      selectedLineCount: totalFileLines - sliceStart,
      startLine,
      totalFileLines,
      userLimitedLines: undefined,
    };
    return selection;
  }
  const endLine = Math.min(startLine + limit, totalFileLines);
  const relativeEnd = sliceIndex(endLine);
  const sliceEnd = relativeEnd < 0 ? Math.max(totalFileLines + relativeEnd, 0) : relativeEnd;
  const selectedLineCount = Math.max(0, sliceEnd - sliceStart);
  if (selectedLineCount > 0 && relativeEnd < 0) scan = yield* scanOf(sliceEnd);
  const selection: Selection = {
    scan,
    selectedLineCount,
    startLine,
    totalFileLines,
    userLimitedLines: endLine - startLine,
  };
  return selection;
});

type Shown = { readonly text: string; readonly details?: readTextTypes.ReadToolDetails };

function oversizedLine(
  head: string,
  selection: Selection,
  truncation: Omit<truncateTypes.TruncationResult, "content">,
  path: string,
  diagnostics: typesModule.ToolDiagnostic[],
): Shown {
  const { startLine, scan } = selection;
  const display = startLine + 1;
  const integral = Number.isInteger(startLine);
  const lineBytes = new TextEncoder().encode(integral ? (head.split("\n")[0] ?? "") : "");
  const lineSize = integral ? scan.firstLineBytes : 0;
  const end = characterEnd(lineBytes, DEFAULT_MAX_BYTES);
  diagnostics.push({
    code: "truncated",
    message: `Line ${display} is ${formatSize(lineSize)}, exceeds the ${formatSize(DEFAULT_MAX_BYTES)} limit; showing its first ${formatSize(end)}. Use bash: sed -n '${display}p' ${path} | tail -c +${end + 1}`,
    severity: "warn",
  });
  return {
    details: { truncation: { ...truncation, outputBytes: end, outputLines: 1 } },
    text: new TextDecoder().decode(lineBytes.subarray(0, end)),
  };
}

function shownText(
  head: string,
  selection: Selection,
  path: string,
  diagnostics: typesModule.ToolDiagnostic[],
): Shown {
  const { scan, startLine, totalFileLines, selectedLineCount, userLimitedLines } = selection;
  const empty = selectedLineCount === 0;
  const endsWithNewline =
    !empty && scan.lastLineStart === scan.end && scan.lastLineStart > scan.start;
  const { content, ...truncation } = truncateHeadOf(head, {
    bytes: empty ? 0 : scan.selectedBytes,
    lines: empty || scan.selectedBytes === 0 ? 0 : selectedLineCount - (endsWithNewline ? 1 : 0),
  });
  if (truncation.firstLineExceedsLimit)
    return oversizedLine(head, selection, truncation, path, diagnostics);
  if (truncation.truncated) {
    const endLineDisplay = startLine + truncation.outputLines;
    const limitText =
      truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
    diagnostics.push({
      code: "truncated",
      message: `Showing lines ${startLine + 1}-${endLineDisplay} of ${totalFileLines}${limitText}. Use offset=${endLineDisplay + 1} to continue.`,
      severity: "info",
    });
    return { details: { truncation }, text: content };
  }
  if (userLimitedLines !== undefined && startLine + userLimitedLines < totalFileLines) {
    diagnostics.push({
      message: `${totalFileLines - (startLine + userLimitedLines)} more lines in file. Use offset=${startLine + userLimitedLines + 1} to continue.`,
      severity: "info",
    });
  }
  return { text: content };
}

const readText = Effect.fnUntraced(function* (
  source: readTextTypes.BinarySource,
  path: string,
  offset: number | undefined,
  limit: number | undefined,
) {
  const selection = yield* selectLines(source, offset, limit);
  const firstBytes = yield* source.read(0, 3);
  const head =
    selection.selectedLineCount === 0
      ? ""
      : yield* readHead(source, selection.scan, startsWithBom(firstBytes));
  const diagnostics: typesModule.ToolDiagnostic[] = [];
  const { text, details } = shownText(head, selection, path, diagnostics);
  const result: typesModule.ToolExecutionResult<readTextTypes.ReadToolDetails> = {
    output: text === "" ? [] : [{ text, type: "text" }],
    ...(details === undefined ? {} : { details }),
    diagnostics,
  };
  return result;
});

const binarySource: readTextTypes.Dual2<
  envTypes.BinaryReader,
  Context,
  readTextTypes.BinarySource
> = Function.dual(
  2,
  (reader: envTypes.BinaryReader, context: Context): readTextTypes.BinarySource => ({
    close: Effect.promise(() => reader.close(context)),
    info: Effect.map(
      Effect.promise(() => reader.info(context)),
      getOrThrow,
    ),
    read: (position, length) =>
      Effect.map(
        Effect.promise(() => reader.read(position, length, context)),
        getOrThrow,
      ),
    scanLines: (options) =>
      Effect.map(
        Effect.promise(() => reader.scanLines(options, context)),
        getOrThrow,
      ),
  }),
);

const readTextModule = {
  binarySource,
  readText,
};

export default readTextModule;
