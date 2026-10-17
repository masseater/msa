import { characterEnd } from "@msa/chord/output";
import { Effect } from "effect";

import { type LineScan, rangeDecoder, startsWithBom } from "../env/index.ts";
import type { ToolDiagnostic, ToolExecutionResult } from "../harness/types.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHeadOf,
  utf8ByteLength,
} from "../truncate.ts";
import type { BinarySource } from "./binary-source.ts";

export type ReadToolDetails = {
  truncation?: Omit<TruncationResult, "content">;
};

const READ_CHUNK = 64 * 1024;

const sliceIndex = (value: number): number => (Number.isNaN(value) ? 0 : Math.trunc(value));

const readHead = Effect.fnUntraced(function* (
  source: BinarySource,
  scan: LineScan,
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
  readonly scan: LineScan;
  readonly startLine: number;
  readonly totalFileLines: number;
  readonly selectedLineCount: number;
  readonly userLimitedLines: number | undefined;
};

const selectLines = Effect.fnUntraced(function* (
  source: BinarySource,
  offset: number | undefined,
  limit: number | undefined,
) {
  const startLine =
    offset === undefined || offset === 0 || Number.isNaN(offset) ? 0 : Math.max(0, offset - 1);
  const sliceStart = sliceIndex(startLine);
  const scanStart = Number.isSafeInteger(sliceStart) ? sliceStart : 0;
  const requestedEnd =
    limit === undefined ? undefined : Math.max(scanStart + 1, sliceIndex(startLine + limit));
  const scanOf = (endLine: number | undefined): Effect.Effect<LineScan> =>
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
      startLine,
      totalFileLines,
      selectedLineCount: totalFileLines - sliceStart,
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
    startLine,
    totalFileLines,
    selectedLineCount,
    userLimitedLines: endLine - startLine,
  };
  return selection;
});

type Shown = { readonly text: string; readonly details?: ReadToolDetails };

function oversizedLine(
  head: string,
  selection: Selection,
  truncation: Omit<TruncationResult, "content">,
  path: string,
  diagnostics: ToolDiagnostic[],
): Shown {
  const { startLine, scan } = selection;
  const display = startLine + 1;
  const integral = Number.isInteger(startLine);
  const lineBytes = new TextEncoder().encode(integral ? (head.split("\n")[0] ?? "") : "");
  const lineSize = integral ? scan.firstLineBytes : 0;
  const end = characterEnd(lineBytes, DEFAULT_MAX_BYTES);
  diagnostics.push({
    severity: "warn",
    code: "truncated",
    message: `Line ${display} is ${formatSize(lineSize)}, exceeds the ${formatSize(DEFAULT_MAX_BYTES)} limit; showing its first ${formatSize(end)}. Use bash: sed -n '${display}p' ${path} | tail -c +${end + 1}`,
  });
  return {
    text: new TextDecoder().decode(lineBytes.subarray(0, end)),
    details: { truncation: { ...truncation, outputBytes: end, outputLines: 1 } },
  };
}

function shownText(
  head: string,
  selection: Selection,
  path: string,
  diagnostics: ToolDiagnostic[],
): Shown {
  const { scan, startLine, totalFileLines, selectedLineCount, userLimitedLines } = selection;
  const empty = selectedLineCount === 0;
  const endsWithNewline =
    !empty && scan.lastLineStart === scan.end && scan.lastLineStart > scan.start;
  const { content, ...truncation } = truncateHeadOf(head, {
    lines: empty || scan.selectedBytes === 0 ? 0 : selectedLineCount - (endsWithNewline ? 1 : 0),
    bytes: empty ? 0 : scan.selectedBytes,
  });
  if (truncation.firstLineExceedsLimit)
    return oversizedLine(head, selection, truncation, path, diagnostics);
  if (truncation.truncated) {
    const endLineDisplay = startLine + truncation.outputLines;
    const limitText =
      truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
    diagnostics.push({
      severity: "info",
      code: "truncated",
      message: `Showing lines ${startLine + 1}-${endLineDisplay} of ${totalFileLines}${limitText}. Use offset=${endLineDisplay + 1} to continue.`,
    });
    return { text: content, details: { truncation } };
  }
  if (userLimitedLines !== undefined && startLine + userLimitedLines < totalFileLines) {
    diagnostics.push({
      severity: "info",
      message: `${totalFileLines - (startLine + userLimitedLines)} more lines in file. Use offset=${startLine + userLimitedLines + 1} to continue.`,
    });
  }
  return { text: content };
}

export const readText = Effect.fnUntraced(function* (
  source: BinarySource,
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
  const diagnostics: ToolDiagnostic[] = [];
  const { text, details } = shownText(head, selection, path, diagnostics);
  const result: ToolExecutionResult<ReadToolDetails> = {
    output: text === "" ? [] : [{ type: "text", text }],
    ...(details === undefined ? {} : { details }),
    diagnostics,
  };
  return result;
});
