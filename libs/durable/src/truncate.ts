import { utf8ByteLength } from "@msa/chord/output";
import * as Function from "effect/Function";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  lastLinePartial: boolean;
  firstLineExceedsLimit: boolean;
  maxLines: number;
  maxBytes: number;
}

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
}

export { utf8ByteLength };

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

export function formatSize(bytes: number): string {
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
  TruncationResult,
  "content" | "truncated" | "truncatedBy" | "outputLines" | "outputBytes" | "firstLineExceedsLimit"
>;

const resultOf = ({ maxLines, maxBytes, totals }: Limits, output: Output): TruncationResult => ({
  ...output,
  totalLines: totals.lines,
  totalBytes: totals.bytes,
  lastLinePartial: false,
  maxLines,
  maxBytes,
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
    if (bytes + lineBytes > maxBytes) return { kept, byBytes: true };
    kept.push(line);
    bytes += lineBytes;
  }
  return { kept, byBytes: false };
};

const truncateLines = (prefix: string, limits: Limits): TruncationResult => {
  const { totals, maxLines, maxBytes } = limits;
  if (totals.lines <= maxLines && totals.bytes <= maxBytes) {
    return resultOf(limits, {
      content: prefix,
      truncated: false,
      truncatedBy: null,
      outputLines: totals.lines,
      outputBytes: totals.bytes,
      firstLineExceedsLimit: false,
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
      truncated: true,
      truncatedBy: "bytes",
      outputLines: 0,
      outputBytes: 0,
      firstLineExceedsLimit: true,
    });
  }
  const { kept, byBytes } = headLines(lines, limits);
  const content = kept.join("\n");
  return resultOf(limits, {
    content,
    truncated: true,
    truncatedBy: byBytes || kept.length >= totals.lines ? "bytes" : "lines",
    outputLines: kept.length,
    outputBytes: utf8ByteLength(content),
    firstLineExceedsLimit: false,
  });
};

const limitsOf = (totals: Totals, options: TruncationOptions): Limits => ({
  maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
  maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  totals,
});

const isText = (args: IArguments): boolean => typeof args[0] === "string";

export const truncateHeadOf: {
  (totals: Totals, options?: TruncationOptions): (prefix: string) => TruncationResult;
  (prefix: string, totals: Totals, options?: TruncationOptions): TruncationResult;
} = Function.dual(
  isText,
  (prefix: string, totals: Totals, options: TruncationOptions = {}): TruncationResult =>
    truncateLines(prefix, limitsOf(totals, options)),
);

export const truncateHead: {
  (options?: TruncationOptions): (content: string) => TruncationResult;
  (content: string, options?: TruncationOptions): TruncationResult;
} = Function.dual(isText, (content: string, options: TruncationOptions = {}): TruncationResult =>
  truncateHeadOf(
    content,
    { lines: splitLinesForCounting(content).length, bytes: utf8ByteLength(content) },
    options,
  ),
);
