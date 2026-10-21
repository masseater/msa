import outputModule from "@msa/chord/output";
import * as Function from "effect/Function";

import type truncateTypes from "./truncate.types.ts";

const { utf8ByteLength } = outputModule;

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

type Totals = { readonly lines: number; readonly bytes: number };

type Limits = {
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly totals: Totals;
};

type Output = Pick<
  truncateTypes.TruncationResult,
  "content" | "truncated" | "truncatedBy" | "outputLines" | "outputBytes" | "firstLineExceedsLimit"
>;

const resultOf = (
  { maxLines, maxBytes, totals }: Limits,
  output: Output,
): truncateTypes.TruncationResult => ({
  ...output,
  lastLinePartial: false,
  maxBytes,
  maxLines,
  totalBytes: totals.bytes,
  totalLines: totals.lines,
});

const headLines = (
  lines: readonly string[],
  { maxLines, maxBytes }: Limits,
): { readonly kept: string[]; readonly byBytes: boolean } => {
  const kept: string[] = [];
  let bytes = 0;
  for (const [index, line] of lines.entries()) {
    if (index >= maxLines) break;
    const lineBytes = utf8ByteLength(line) + (index > 0 ? 1 : 0);
    if (bytes + lineBytes > maxBytes) return { byBytes: true, kept };
    kept.push(line);
    bytes += lineBytes;
  }
  return { byBytes: false, kept };
};

const truncateLines = (prefix: string, limits: Limits): truncateTypes.TruncationResult => {
  const { totals, maxLines, maxBytes } = limits;
  if (totals.lines <= maxLines && totals.bytes <= maxBytes) {
    return resultOf(limits, {
      content: prefix,
      firstLineExceedsLimit: false,
      outputBytes: totals.bytes,
      outputLines: totals.lines,
      truncated: false,
      truncatedBy: null,
    });
  }
  const lines = splitLinesForCounting(prefix);
  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new Error("truncateHeadOf needs a non-empty prefix when the text exceeds the limits");
  }
  if (utf8ByteLength(firstLine) > maxBytes) {
    return resultOf(limits, {
      content: "",
      firstLineExceedsLimit: true,
      outputBytes: 0,
      outputLines: 0,
      truncated: true,
      truncatedBy: "bytes",
    });
  }
  const { kept, byBytes } = headLines(lines, limits);
  const content = kept.join("\n");
  return resultOf(limits, {
    content,
    firstLineExceedsLimit: false,
    outputBytes: utf8ByteLength(content),
    outputLines: kept.length,
    truncated: true,
    truncatedBy: byBytes || kept.length >= totals.lines ? "bytes" : "lines",
  });
};

const limitsOf = (totals: Totals, options: truncateTypes.TruncationOptions): Limits => ({
  maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
  totals,
});

const isText = (args: IArguments): boolean => typeof args[0] === "string";

const truncateHeadOf: {
  (
    totals: Totals,
    options?: truncateTypes.TruncationOptions,
  ): (prefix: string) => truncateTypes.TruncationResult;
  (
    prefix: string,
    totals: Totals,
    options?: truncateTypes.TruncationOptions,
  ): truncateTypes.TruncationResult;
} = Function.dual(
  isText,
  (
    prefix: string,
    totals: Totals,
    options: truncateTypes.TruncationOptions = {},
  ): truncateTypes.TruncationResult => truncateLines(prefix, limitsOf(totals, options)),
);

const truncateHead: {
  (options?: truncateTypes.TruncationOptions): (content: string) => truncateTypes.TruncationResult;
  (content: string, options?: truncateTypes.TruncationOptions): truncateTypes.TruncationResult;
} = Function.dual(
  isText,
  (
    content: string,
    options: truncateTypes.TruncationOptions = {},
  ): truncateTypes.TruncationResult =>
    truncateHeadOf(
      content,
      { bytes: utf8ByteLength(content), lines: splitLinesForCounting(content).length },
      options,
    ),
);

const truncate = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateHeadOf,
  utf8ByteLength,
};

export default truncate;
