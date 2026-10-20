import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type findTypesModule from "../find.types.ts";
import renderUtils from "../render-utils.ts";
import truncate from "../truncate.ts";
import listOutput from "./list-output.ts";

const { getTextOutput, invalidArgText, shortenPath, str } = renderUtils;
const { DEFAULT_MAX_BYTES, formatSize } = truncate;
const { formatListResult } = listOutput;

const { Text } = tui;

function formatFindCall(
  args: { pattern: string; path?: string; limit?: number } | undefined,
  theme: themeTypes.Theme,
): string {
  const pattern = str(args?.pattern);
  const rawPath = str(args?.path);
  const path = rawPath === null ? null : shortenPath(rawPath || ".");
  const limit = args?.limit;
  const invalidArg = invalidArgText(theme);
  let text =
    theme.fg("toolTitle", theme.bold("find")) +
    " " +
    (pattern === null ? invalidArg : theme.fg("accent", pattern || "")) +
    theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
  if (limit !== undefined) {
    text += theme.fg("toolOutput", ` (limit ${limit})`);
  }
  return text;
}
function formatFindResult(
  result: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: findTypesModule.FindToolDetails;
  },
  options: extensionsTypesTypes.ToolRenderResultOptions,
  theme: themeTypes.Theme,
  showImages: boolean,
): string {
  const resultLimit = result.details?.resultLimitReached;
  const truncation = result.details?.truncation;
  const warnings: string[] = [];
  if (resultLimit !== undefined && resultLimit !== 0) warnings.push(`${resultLimit} results limit`);
  if (truncation?.truncated === true)
    warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
  const output = getTextOutput(result, showImages).trim();
  return formatListResult({ expanded: options.expanded, noun: "files", output, theme, warnings });
}

const findRenderers: Pick<
  extensionsTypesTypes.ToolDefinition<any, any>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatFindCall(args as any, theme));
    return text;
  },
  renderResult(result, options, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatFindResult(result as any, options, theme, context.showImages));
    return text;
  },
};

const find = {
  findRenderers,
};

export default find;
