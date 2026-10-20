import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import keybindingHints from "../../../modes/interactive/components/keybinding-hints.ts";
import themeModule from "../../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type readContentTypes from "../read-content.types.ts";
import renderUtils from "../render-utils.ts";
import truncate from "../truncate.ts";
import readClassification from "./read-classification.ts";
import type readClassificationTypes from "./read-classification.types.ts";

const { getLanguageFromPath, highlightCode } = themeModule;
const { formatReadLineRange, getTextOutput, renderToolPath, replaceTabs, str } = renderUtils;
const { getCompactReadClassification } = readClassification;
const { expandHint, keyText } = keybindingHints;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } = truncate;

const { Text } = tui;

type ReadRenderArgs = { path?: string; file_path?: string; offset?: unknown; limit?: unknown };
function styledReadLineRange(args: ReadRenderArgs | undefined, theme: themeTypes.Theme): string {
  const range = formatReadLineRange(args?.offset, args?.limit);
  return range === "" ? "" : theme.fg("warning", range);
}
function formatReadCall(
  args: ReadRenderArgs | undefined,
  theme: themeTypes.Theme,
  cwd: string,
): string {
  const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
  return `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${styledReadLineRange(args, theme)}`;
}
function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end--;
  }
  return lines.slice(0, end);
}
function formatCompactReadCall(
  classification: readClassificationTypes.CompactReadClassification,
  args: ReadRenderArgs | undefined,
  theme: themeTypes.Theme,
): string {
  const hint = theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
  if (classification.kind === "skill") {
    return (
      theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
      theme.fg("customMessageText", classification.label) +
      styledReadLineRange(args, theme) +
      hint
    );
  }

  return (
    theme.fg("toolTitle", theme.bold(`read ${classification.kind}`)) +
    " " +
    theme.fg("accent", classification.label) +
    styledReadLineRange(args, theme) +
    hint
  );
}
function formatReadResult(
  args: ReadRenderArgs | undefined,
  result: {
    content: (aiTypes.TextContent | aiTypes.ImageContent)[];
    details?: readContentTypes.ReadToolDetails | undefined;
  },
  options: extensionsTypesTypes.ToolRenderResultOptions,
  theme: themeTypes.Theme,
  showImages: boolean,
  _cwd: string,
  isError: boolean,
): string {
  if (!options.expanded && !isError) {
    return "";
  }

  const rawPath = str(args?.file_path ?? args?.path);
  const output = getTextOutput(result, showImages);
  const lang =
    !isError && rawPath !== null && rawPath !== "" ? getLanguageFromPath(rawPath) : undefined;
  const renderedLines =
    lang !== undefined && lang !== ""
      ? highlightCode(replaceTabs(output), lang)
      : output.split("\n");
  const lines = trimTrailingEmptyLines(renderedLines);
  const maxLines = options.expanded ? lines.length : 10;
  const displayLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;
  let text = `\n${displayLines.map((line) => (lang !== undefined && lang !== "" ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`;
  if (remaining > 0) {
    text += `\n${expandHint(`${remaining} more lines`)}`;
  }

  const truncation = result.details?.truncation;
  if (truncation?.truncated === true) {
    if (truncation.firstLineExceedsLimit) {
      text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
    } else if (truncation.truncatedBy === "lines") {
      text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
    } else {
      text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
    }
  }
  return text;
}

const readRenderers: Pick<
  extensionsTypesTypes.ToolDefinition<any, readContentTypes.ReadToolDetails | undefined>,
  "renderCall" | "renderResult"
> = {
  renderCall(rawArgs, theme, context) {
    const args = rawArgs as ReadRenderArgs | undefined;
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    const classification = context.expanded
      ? undefined
      : getCompactReadClassification({ args, cwd: context.cwd });
    text.setText(
      classification === undefined
        ? formatReadCall(args, theme, context.cwd)
        : formatCompactReadCall(classification, args, theme),
    );
    return text;
  },
  renderResult(result, options, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(
      formatReadResult(
        context.args as ReadRenderArgs | undefined,
        result,
        options,
        theme,
        context.showImages,
        context.cwd,
        context.isError,
      ),
    );
    return text;
  },
};

const read = {
  readRenderers,
};

export default read;
