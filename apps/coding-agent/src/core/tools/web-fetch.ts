import { Effect } from "effect";
import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import treg from "../treg.ts";
import type tregTypes from "../treg.types.ts";
import web from "./renderers/web.ts";
import truncate from "./truncate.ts";
import type webFetchTypes from "./web-fetch.types.ts";

const { callTreg, pickString, rows } = treg;
const { ToolFailure, fromPromise, unwrapForeign } = platform;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } = truncate;
const { webFetchRenderers } = web;

const webFetchSchema = Type.Object({
  url: Type.String({ description: "URL of the page to read." }),
});

const fetchPage = Effect.fn("webFetch")(function* (
  options: tregTypes.TregOptions,
  url: string,
  signal: AbortSignal | undefined,
) {
  const result = yield* fromPromise(() => callTreg(options, "treg.web.extract", { url }, signal));
  const page = rows(result.output, "pages")[0];
  const details: webFetchTypes.WebFetchToolDetails = {
    url: pickString(page, "final_url", "url") ?? url,
    ...(result.servedBy !== undefined && result.servedBy !== ""
      ? { servedBy: result.servedBy }
      : {}),
    ...(result.costMicro === undefined ? {} : { costMicro: result.costMicro }),
  };
  const title = pickString(page, "title");
  if (title !== undefined && title !== "") details.title = title;
  const body = pickString(page, "text", "markdown", "content", "raw_content");
  if (body === undefined || body === "") {
    return yield* ToolFailure.make({
      message: `Could not read ${url}: no vendor returned its content.`,
    });
  }
  const truncation = truncateHead(
    [title !== undefined && title !== "" ? `# ${title}` : undefined, details.url, "", body]
      .filter((line) => line !== undefined)
      .join("\n"),
  );
  let text = truncation.content;
  if (truncation.truncated) {
    const limit =
      truncation.truncatedBy === "lines"
        ? `${DEFAULT_MAX_LINES} lines`
        : formatSize(DEFAULT_MAX_BYTES);
    text += `\n\n[Truncated at ${limit}]`;
    details.truncation = truncation;
  }
  return { content: [{ text, type: "text" as const }], details };
});

function createWebFetchToolDefinition(
  options: tregTypes.TregOptions,
): extensionsTypesTypes.ToolDefinition<typeof webFetchSchema, webFetchTypes.WebFetchToolDetails> {
  return {
    annotations: { openWorldHint: true, readOnlyHint: true },
    description: `Read a web page as Markdown. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    execute: (_toolCallId, params, signal) =>
      Effect.runPromise(unwrapForeign(fetchPage(options, params.url, signal))),
    executionMode: "parallel",
    label: "web fetch",
    name: "web_fetch",
    parameters: webFetchSchema,
    promptSnippet: "Read a web page as Markdown",
    ...webFetchRenderers,
  };
}

const webFetch = {
  createWebFetchToolDefinition,
  webFetchSchema,
};

export default webFetch;
