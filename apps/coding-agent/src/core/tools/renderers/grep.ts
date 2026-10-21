import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type grepTypesModule from "../grep.types.ts";
import renderUtils from "../render-utils.ts";
import truncate from "../truncate.ts";
import listOutput from "./list-output.ts";

const { getTextOutput, invalidArgText, shortenPath, str } = renderUtils;
const { DEFAULT_MAX_BYTES, formatSize } = truncate;
const { formatListResult } = listOutput;

const { Text } = tui;

function formatGrepCall(
  args: { pattern: string; path?: string; glob?: string; limit?: number } | undefined,
  theme: themeTypes.Theme,
): string {
  const pattern = str(args?.pattern);
  const rawPath = str(args?.path);
  const path = rawPath === null ? null : shortenPath(rawPath || ".");
  const glob = str(args?.glob);
  const limit = args?.limit;
  const invalidArg = invalidArgText(theme);
  let text =
    theme.fg("toolTitle", theme.bold("grep")) +
    " " +
    (pattern === null ? invalidArg : theme.fg("accent", `/${pattern || ""}/`)) +
    theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
  if (glob !== null && glob !== "") text += theme.fg("toolOutput", ` (${glob})`);
  if (limit !== undefined) text += theme.fg("toolOutput", ` limit ${limit}`);
  return text;
}
function formatGrepResult(
  result: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: grepTypesModule.GrepToolDetails;
  },
  options: extensionsTypesTypes.ToolRenderResultOptions,
  theme: themeTypes.Theme,
  showImages: boolean,
): string {
  const matchLimit = result.details?.matchLimitReached;
  const truncation = result.details?.truncation;
  const warnings: string[] = [];
  if (matchLimit !== undefined && matchLimit !== 0) warnings.push(`${matchLimit} matches limit`);
  if (truncation?.truncated === true)
    warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
  if (result.details?.linesTruncated === true) warnings.push("some lines truncated");
  const output = getTextOutput(result, showImages).trim();
  return formatListResult({ expanded: options.expanded, noun: "lines", output, theme, warnings });
}

const grepRenderers: Pick<
  extensionsTypesTypes.ToolDefinition<any, any>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatGrepCall(args as any, theme));
    return text;
  },
  renderResult(result, options, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatGrepResult(result as any, options, theme, context.showImages));
    return text;
  },
};

const grep = {
  grepRenderers,
};

export default grep;
