import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type lsTypesModule from "../ls.types.ts";
import renderUtils from "../render-utils.ts";
import truncate from "../truncate.ts";
import listOutput from "./list-output.ts";

const { getTextOutput, renderToolPath, str } = renderUtils;
const { DEFAULT_MAX_BYTES, formatSize } = truncate;
const { formatListResult } = listOutput;

const { Text } = tui;

function formatLsCall(
  args: { path?: string; limit?: number } | undefined,
  theme: themeTypes.Theme,
  cwd: string,
): string {
  const limit = args?.limit;
  const pathDisplay = renderToolPath(str(args?.path), theme, cwd, { emptyFallback: "." });
  let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${pathDisplay}`;
  if (limit !== undefined) {
    text += theme.fg("toolOutput", ` (limit ${limit})`);
  }
  return text;
}
function formatLsResult(
  result: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: lsTypesModule.LsToolDetails;
  },
  options: extensionsTypesTypes.ToolRenderResultOptions,
  theme: themeTypes.Theme,
  showImages: boolean,
): string {
  const entryLimit = result.details?.entryLimitReached;
  const truncation = result.details?.truncation;
  const warnings: string[] = [];
  if (entryLimit !== undefined && entryLimit !== 0) warnings.push(`${entryLimit} entries limit`);
  if (truncation?.truncated === true)
    warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
  const output = getTextOutput(result, showImages).trim();
  return formatListResult({ expanded: options.expanded, noun: "entries", output, theme, warnings });
}

const lsRenderers: Pick<
  extensionsTypesTypes.ToolDefinition<any, any>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatLsCall(args as any, theme, context.cwd));
    return text;
  },
  renderResult(result, options, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatLsResult(result as any, options, theme, context.showImages));
    return text;
  },
};

const ls = {
  lsRenderers,
};

export default ls;
