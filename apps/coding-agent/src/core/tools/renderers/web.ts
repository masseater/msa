import { getCapabilities, hyperlink, Text } from "@msa/tui";

import { expandHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import { getTextOutput, invalidArgText, str } from "../render-utils.ts";
import type { WebFetchToolDetails } from "../web-fetch.ts";
import type { WebSearchToolDetails } from "../web-search.ts";

type Renderers = Pick<ToolDefinition<any, any>, "renderCall" | "renderResult">;
type Result = Parameters<NonNullable<Renderers["renderResult"]>>[0];

function link(text: string, url: string | undefined): string {
  return url && getCapabilities().hyperlinks ? hyperlink(text, url) : text;
}

function provenance(details: { servedBy?: string; costMicro?: number } | undefined): string {
  const parts: string[] = [];
  if (details?.servedBy !== undefined && details?.servedBy !== "")
    parts.push(`via ${details.servedBy}`);
  if (details?.costMicro !== undefined)
    parts.push(`$${Number((details.costMicro / 1e6).toFixed(6))}`);
  return parts.join(", ");
}

function formatSearchResult(
  details: WebSearchToolDetails | undefined,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const results = details?.results ?? [];
  const summary = [
    `${results.length} results`,
    provenance(details),
    details?.truncation?.truncated === true ? "truncated" : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!options.expanded) return `\n${expandHint(summary)}`;
  const lines = results.map((result) => {
    const title = link(theme.fg("toolOutput", result.title), result.url);
    return result.url !== undefined && result.url !== ""
      ? `${title}\n  ${theme.fg("muted", result.url)}`
      : title;
  });
  return `\n${[...lines, theme.fg("muted", summary)].join("\n")}`;
}

function formatFetchResult(
  result: Result,
  details: WebFetchToolDetails | undefined,
  options: ToolRenderResultOptions,
  theme: Theme,
  showImages: boolean,
): string {
  const output = getTextOutput(result, showImages);
  const summary = [
    `${output.split("\n").length} lines`,
    provenance(details),
    details?.truncation?.truncated === true ? "truncated" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const heading =
    details?.title !== undefined && details?.title !== ""
      ? `\n${link(theme.fg("toolOutput", details.title), details.url)}`
      : "";
  if (!options.expanded) return `${heading}\n${expandHint(summary)}`;
  return `\n${theme.fg("toolOutput", output)}\n${theme.fg("muted", summary)}`;
}

function textRenderers(
  formatArgs: (args: any, theme: Theme) => string,
  formatResult: (
    result: Result,
    options: ToolRenderResultOptions,
    theme: Theme,
    showImages: boolean,
  ) => string,
): Renderers {
  return {
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatArgs(args, theme));
      return text;
    },
    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      if (context.isPartial) text.setText("");
      else if (context.isError) {
        text.setText(`\n${theme.fg("error", getTextOutput(result, false).trim())}`);
      } else text.setText(formatResult(result, options, theme, context.showImages));
      return text;
    },
  };
}

function formatCall(name: string, value: unknown, theme: Theme): string {
  const argument = str(value);
  return `${theme.fg("toolTitle", theme.bold(name))} ${
    argument === null ? invalidArgText(theme) : theme.fg("accent", argument)
  }`;
}

export const webSearchRenderers = textRenderers(
  (args: { query?: string } | undefined, theme) => formatCall("web search", args?.query, theme),
  (result, options, theme) =>
    formatSearchResult(result.details as WebSearchToolDetails | undefined, options, theme),
);

export const webFetchRenderers = textRenderers(
  (args: { url?: string } | undefined, theme) => formatCall("web fetch", args?.url, theme),
  (result, options, theme, showImages) =>
    formatFetchResult(
      result,
      result.details as WebFetchToolDetails | undefined,
      options,
      theme,
      showImages,
    ),
);
