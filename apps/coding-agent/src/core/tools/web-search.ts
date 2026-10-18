import { Effect } from "effect";
import { type Static, Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import { fromPromise, platformRuntime, unwrapForeign } from "../platform/index.ts";
import { callTreg, pickString, rows, type TregOptions } from "../treg.ts";
import { webSearchRenderers } from "./renderers/web.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate.ts";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

const webSearchSchema = Type.Object({
  query: Type.String({ description: "What to search the web for." }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Maximum number of results (default: ${DEFAULT_LIMIT}).`,
    }),
  ),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

export interface WebSearchResultSummary {
  title: string;
  url?: string;
}

export interface WebSearchToolDetails {
  results: WebSearchResultSummary[];
  servedBy?: string;
  costMicro?: number;
  truncation?: TruncationResult;
}

function formatRow(row: unknown, index: number): string {
  const title = pickString(row, "title", "name");
  const url = pickString(row, "url", "link");
  const snippet = pickString(row, "snippet", "description", "content", "text");
  if ((title === undefined || title === "") && (url === undefined || url === ""))
    return `${index + 1}. ${JSON.stringify(row)}`;
  const lines = [`${index + 1}. ${title ?? url}`];
  if (url !== undefined && url !== "") lines.push(`   ${url}`);
  const date = pickString(row, "publishedDate", "published_date", "date");
  if (date !== undefined && date !== "") lines.push(`   Published: ${date}`);
  if (snippet !== undefined && snippet !== "")
    lines.push(...snippet.split("\n").map((line) => `   ${line}`));
  return lines.join("\n");
}

const searchWeb = Effect.fn("webSearch")(function* (
  options: TregOptions,
  query: string,
  limit: number,
  signal: AbortSignal | undefined,
) {
  const result = yield* fromPromise(() =>
    callTreg(options, "treg.web.search", { q: query, limit }, signal),
  );
  const found = rows(result.output, "results");
  const details: WebSearchToolDetails = {
    results: found.map((row) => {
      const url = pickString(row, "url", "link");
      return {
        title: pickString(row, "title", "name") ?? url ?? "(untitled)",
        ...(url !== undefined && url !== "" ? { url } : {}),
      };
    }),
    ...(result.servedBy !== undefined && result.servedBy !== ""
      ? { servedBy: result.servedBy }
      : {}),
    ...(result.costMicro === undefined ? {} : { costMicro: result.costMicro }),
  };
  if (found.length === 0) {
    return { content: [{ type: "text" as const, text: "No results found." }], details };
  }
  const truncation = truncateHead(found.map(formatRow).join("\n\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[${formatSize(DEFAULT_MAX_BYTES)} limit reached]`;
    details.truncation = truncation;
  }
  return { content: [{ type: "text" as const, text }], details };
});

export function createWebSearchToolDefinition(
  options: TregOptions,
): ToolDefinition<typeof webSearchSchema, WebSearchToolDetails> {
  return {
    name: "web_search",
    label: "web search",
    description: `Search the web. Returns each result's title, URL and snippet. Output is truncated to ${DEFAULT_MAX_BYTES / 1024}KB.`,
    promptSnippet: "Search the web for current information",
    promptGuidelines: [
      "Use web_search for information that may have changed after your training data or that the workspace does not have, then read the few best results with web_fetch; cite the URLs you rely on.",
    ],
    parameters: webSearchSchema,
    executionMode: "parallel",
    execute: (_toolCallId, params, signal) =>
      platformRuntime.runPromise(
        unwrapForeign(searchWeb(options, params.query, params.limit ?? DEFAULT_LIMIT, signal)),
      ),
    ...webSearchRenderers,
  };
}
