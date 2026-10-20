import { dual } from "effect/Function";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;

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

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const byteLength = (text: string): number => Buffer.byteLength(text, "utf-8");

interface Measured {
  content: string;
  lines: string[];
  totalLines: number;
  totalBytes: number;
  maxLines: number;
  maxBytes: number;
}

function measure(content: string, options: TruncationOptions): Measured {
  const lines = splitLinesForCounting(content);
  return {
    content,
    lines,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
    totalBytes: byteLength(content),
    totalLines: lines.length,
  };
}

function untruncated(measured: Measured): TruncationResult {
  return {
    content: measured.content,
    firstLineExceedsLimit: false,
    lastLinePartial: false,
    maxBytes: measured.maxBytes,
    maxLines: measured.maxLines,
    outputBytes: measured.totalBytes,
    outputLines: measured.totalLines,
    totalBytes: measured.totalBytes,
    totalLines: measured.totalLines,
    truncated: false,
    truncatedBy: null,
  };
}

function truncatedResult(
  measured: Measured,
  truncatedBy: "lines" | "bytes",
  output: { lines: string[]; lastLinePartial?: boolean; firstLineExceedsLimit?: boolean },
): TruncationResult {
  const content = output.lines.join("\n");
  return {
    content,
    firstLineExceedsLimit: output.firstLineExceedsLimit ?? false,
    lastLinePartial: output.lastLinePartial ?? false,
    maxBytes: measured.maxBytes,
    maxLines: measured.maxLines,
    outputBytes: byteLength(content),
    outputLines: output.lines.length,
    totalBytes: measured.totalBytes,
    totalLines: measured.totalLines,
    truncated: true,
    truncatedBy,
  };
}

const fitsLimits = (measured: Measured): boolean =>
  measured.totalLines <= measured.maxLines && measured.totalBytes <= measured.maxBytes;

const isContentFirst = (args: IArguments): boolean => typeof args[0] === "string";

function truncateHeadImpl(content: string, options: TruncationOptions = {}): TruncationResult {
  const measured = measure(content, options);
  if (fitsLimits(measured)) return untruncated(measured);
  const { lines, maxLines, maxBytes } = measured;

  if (byteLength(lines[0] ?? "") > maxBytes) {
    return truncatedResult(measured, "bytes", { firstLineExceedsLimit: true, lines: [] });
  }

  const kept: string[] = [];
  let keptBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  for (const [index, line] of lines.slice(0, maxLines).entries()) {
    const lineBytes = byteLength(line) + (index > 0 ? 1 : 0);
    if (keptBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    kept.push(line);
    keptBytes += lineBytes;
  }
  if (kept.length >= maxLines && keptBytes <= maxBytes) truncatedBy = "lines";
  return truncatedResult(measured, truncatedBy, { lines: kept });
}

export const truncateHead: {
  (options?: TruncationOptions): (content: string) => TruncationResult;
  (content: string, options?: TruncationOptions): TruncationResult;
} = dual(isContentFirst, truncateHeadImpl);

function truncateTailImpl(content: string, options: TruncationOptions = {}): TruncationResult {
  const measured = measure(content, options);
  if (fitsLimits(measured)) return untruncated(measured);
  const { lines, maxLines, maxBytes } = measured;

  const kept: string[] = [];
  let keptBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  let lastLinePartial = false;
  for (let index = lines.length - 1; index >= 0 && kept.length < maxLines; index--) {
    const line = lines[index];
    if (line === undefined) continue;
    const lineBytes = byteLength(line) + (kept.length > 0 ? 1 : 0);
    if (keptBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      if (kept.length === 0) {
        const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
        kept.unshift(truncatedLine);
        keptBytes = byteLength(truncatedLine);
        lastLinePartial = true;
      }
      break;
    }
    kept.unshift(line);
    keptBytes += lineBytes;
  }
  if (kept.length >= maxLines && keptBytes <= maxBytes) truncatedBy = "lines";
  return truncatedResult(measured, truncatedBy, { lastLinePartial, lines: kept });
}

export const truncateTail: {
  (options?: TruncationOptions): (content: string) => TruncationResult;
  (content: string, options?: TruncationOptions): TruncationResult;
} = dual(isContentFirst, truncateTailImpl);

function truncateStringToBytesFromEnd(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, "utf-8");
  if (buf.length <= maxBytes) {
    return str;
  }

  let start = buf.length - maxBytes;

  while (start < buf.length && ((buf[start] ?? 0) & 0xc0) === 0x80) {
    start++;
  }

  return buf.slice(start).toString("utf-8");
}

function truncateLineImpl(
  line: string,
  maxChars: number = GREP_MAX_LINE_LENGTH,
): { text: string; wasTruncated: boolean } {
  if (line.length <= maxChars) {
    return { text: line, wasTruncated: false };
  }
  return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}

export const truncateLine: {
  (maxChars?: number): (line: string) => { text: string; wasTruncated: boolean };
  (line: string, maxChars?: number): { text: string; wasTruncated: boolean };
} = dual(isContentFirst, truncateLineImpl);

export interface MiddleTruncationResult {
  content: string;
  truncated: boolean;
  removedChars: number;
  totalBytes: number;
  totalLines: number;
}

function truncateMiddleImpl(content: string, maxBytes: number): MiddleTruncationResult {
  const buf = Buffer.from(content, "utf-8");
  const totalLines = splitLinesForCounting(content).length;
  if (buf.length <= maxBytes) {
    return { content, removedChars: 0, totalBytes: buf.length, totalLines, truncated: false };
  }
  const isBoundary = (index: number) => index >= buf.length || ((buf[index] ?? 0) & 0xc0) !== 0x80;
  let headEnd = Math.floor(maxBytes / 2);
  while (headEnd > 0 && !isBoundary(headEnd)) headEnd--;
  let tailStart = buf.length - (maxBytes - Math.floor(maxBytes / 2));
  while (tailStart < buf.length && !isBoundary(tailStart)) tailStart++;
  const head = buf.subarray(0, headEnd).toString("utf-8");
  const tail = buf.subarray(tailStart).toString("utf-8");
  const removedChars = Array.from(buf.subarray(headEnd, tailStart).toString("utf-8")).length;
  return {
    content: `${head}…${removedChars} chars truncated…${tail}`,
    removedChars,
    totalBytes: buf.length,
    totalLines,
    truncated: true,
  };
}

export const truncateMiddle: {
  (maxBytes: number): (content: string) => MiddleTruncationResult;
  (content: string, maxBytes: number): MiddleTruncationResult;
} = dual(2, truncateMiddleImpl);
