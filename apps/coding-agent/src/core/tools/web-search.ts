import { Effect } from "effect";
import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import treg from "../treg.ts";
import type tregTypes from "../treg.types.ts";
import web from "./renderers/web.ts";
import truncate from "./truncate.ts";
import type webSearchTypes from "./web-search.types.ts";

const { callTreg, pickString, rows } = treg;
const { fromPromise, unwrapForeign } = platform;
const { DEFAULT_MAX_BYTES, formatSize, truncateHead } = truncate;
const { webSearchRenderers } = web;

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

const webSearchSchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      description: `Maximum number of results (default: ${DEFAULT_LIMIT}).`,
      maximum: MAX_LIMIT,
      minimum: 1,
    }),
  ),
  query: Type.String({ description: "What to search the web for." }),
});

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
  options: tregTypes.TregOptions,
  query: string,
  limit: number,
  signal: AbortSignal | undefined,
) {
  const result = yield* fromPromise(() =>
    callTreg(options, "treg.web.search", { limit, q: query }, signal),
  );
  const found = rows(result.output, "results");
  const details: webSearchTypes.WebSearchToolDetails = {
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
    return { content: [{ text: "No results found.", type: "text" as const }], details };
  }
  const truncation = truncateHead(found.map(formatRow).join("\n\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[${formatSize(DEFAULT_MAX_BYTES)} limit reached]`;
    details.truncation = truncation;
  }
  return { content: [{ text, type: "text" as const }], details };
});

function createWebSearchToolDefinition(
  options: tregTypes.TregOptions,
): extensionsTypesTypes.ToolDefinition<
  typeof webSearchSchema,
  webSearchTypes.WebSearchToolDetails
> {
  return {
    annotations: { openWorldHint: true, readOnlyHint: true },
    description: `Search the web. Returns each result's title, URL and snippet. Output is truncated to ${DEFAULT_MAX_BYTES / 1024}KB.`,
    execute: (_toolCallId, params, signal) =>
      Effect.runPromise(
        unwrapForeign(searchWeb(options, params.query, params.limit ?? DEFAULT_LIMIT, signal)),
      ),
    executionMode: "parallel",
    label: "web search",
    name: "web_search",
    parameters: webSearchSchema,
    promptGuidelines: [
      "Use web_search for information that may have changed after your training data or that the workspace does not have, then read the few best results with web_fetch; cite the URLs you rely on.",
    ],
    promptSnippet: "Search the web for current information",
    ...webSearchRenderers,
  };
}

const webSearch = {
  createWebSearchToolDefinition,
  webSearchSchema,
};

export default webSearch;
