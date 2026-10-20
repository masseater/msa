import { Type } from "typebox";

import type grepSupportTypes from "./grep-support.types.ts";
import truncate from "./truncate.ts";

const { DEFAULT_MAX_BYTES, GREP_MAX_LINE_LENGTH, formatSize, truncateHead } = truncate;

const grepSchema = Type.Object({
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
const DEFAULT_GREP_LIMIT = 100;
function rgArguments(request: grepSupportTypes.GrepRequest): string[] {
  const args = ["--json", "--line-number", "--color=never", "--hidden"];
  if (request.ignoreCase === true) args.push("--ignore-case");
  if (request.literal === true) args.push("--fixed-strings");
  if (request.glob !== undefined && request.glob !== "") args.push("--glob", request.glob);
  args.push("--", request.pattern, request.searchPath);
  return args;
}
function formatGrepOutput(input: grepSupportTypes.GrepOutputInput) {
  const { effectiveLimit } = input;
  const truncation = truncateHead(input.outputLines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  const details: grepSupportTypes.GrepToolDetails = {};
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

const grepSupport = {
  DEFAULT_GREP_LIMIT,
  formatGrepOutput,
  grepSchema,
  rgArguments,
};

export default grepSupport;
