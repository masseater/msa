import { Type } from "typebox";

import {
  DEFAULT_MAX_BYTES,
  GREP_MAX_LINE_LENGTH,
  type TruncationResult,
  formatSize,
  truncateHead,
} from "./truncate.ts";

export const grepSchema = Type.Object({
  context: Type.Optional(
    Type.Number({
      description: "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({ description: "Case-insensitive search (default: false)" }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Treat pattern as literal string instead of regex (default: false)",
    }),
  ),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
});

export const DEFAULT_GREP_LIMIT = 100;

export interface GrepToolDetails {
  truncation?: TruncationResult;
  matchLimitReached?: number;
  linesTruncated?: boolean;
}

export interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
  readFile: (absolutePath: string) => Promise<string> | string;
}

export interface GrepRequest {
  pattern: string;
  searchPath: string;
  glob: string | undefined;
  ignoreCase: boolean | undefined;
  literal: boolean | undefined;
  contextValue: number;
  effectiveLimit: number;
  isDirectory: boolean;
}

export interface RgMatch {
  filePath: string;
  lineNumber: number;
  lineText?: string | undefined;
}

export function rgArguments(request: GrepRequest): string[] {
  const args = ["--json", "--line-number", "--color=never", "--hidden"];
  if (request.ignoreCase === true) args.push("--ignore-case");
  if (request.literal === true) args.push("--fixed-strings");
  if (request.glob !== undefined && request.glob !== "") args.push("--glob", request.glob);
  args.push("--", request.pattern, request.searchPath);
  return args;
}

export class RgMatchCollector {
  readonly matches: RgMatch[] = [];
  matchCount = 0;
  matchLimitReached = false;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  readonly onLine = (line: string): boolean => {
    if (line.trim() === "" || this.matchCount >= this.limit) return false;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return false;
    }
    if (event.type !== "match") return false;
    this.matchCount++;
    const filePath = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    if (typeof filePath === "string" && filePath !== "" && typeof lineNumber === "number") {
      this.matches.push({ filePath, lineNumber, lineText: event.data?.lines?.text });
    }
    this.matchLimitReached = this.matchCount >= this.limit;
    return this.matchLimitReached;
  };
}

export interface GrepOutputInput {
  outputLines: string[];
  effectiveLimit: number;
  matchLimitReached: boolean;
  linesTruncated: boolean;
}

export function formatGrepOutput(input: GrepOutputInput) {
  const { effectiveLimit } = input;
  const truncation = truncateHead(input.outputLines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  const details: GrepToolDetails = {};
  const notices: string[] = [];
  if (input.matchLimitReached) {
    notices.push(
      `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
    );
    details.matchLimitReached = effectiveLimit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    details.truncation = truncation;
  }
  if (input.linesTruncated) {
    notices.push(
      `Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
    );
    details.linesTruncated = true;
  }
  const text =
    notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
  return {
    content: [{ text, type: "text" as const }],
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}
