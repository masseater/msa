import { Effect } from "effect";
import { type Static, Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import { fromPromise, platformRuntime, ToolFailure, unwrapForeign } from "../platform/index.ts";
import { callTreg, pickString, rows, type TregOptions } from "../treg.ts";
import { webFetchRenderers } from "./renderers/web.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "./truncate.ts";

const webFetchSchema = Type.Object({
  url: Type.String({ description: "URL of the page to read." }),
});

export type WebFetchToolInput = Static<typeof webFetchSchema>;

export interface WebFetchToolDetails {
  title?: string;
  url: string;
  servedBy?: string;
  costMicro?: number;
  truncation?: TruncationResult;
}

const fetchPage = Effect.fn("webFetch")(function* (
  options: TregOptions,
  url: string,
  signal: AbortSignal | undefined,
) {
  const result = yield* fromPromise(() => callTreg(options, "treg.web.extract", { url }, signal));
  const page = rows(result.output, "pages")[0];
  const details: WebFetchToolDetails = {
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
    return yield* new ToolFailure({
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
  return { content: [{ type: "text" as const, text }], details };
});

export function createWebFetchToolDefinition(
  options: TregOptions,
): ToolDefinition<typeof webFetchSchema, WebFetchToolDetails> {
  return {
    name: "web_fetch",
    label: "web fetch",
    description: `Read a web page as Markdown. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    promptSnippet: "Read a web page as Markdown",
    parameters: webFetchSchema,
    executionMode: "parallel",
    execute: (_toolCallId, params, signal) =>
      platformRuntime.runPromise(unwrapForeign(fetchPage(options, params.url, signal))),
    ...webFetchRenderers,
  };
}
