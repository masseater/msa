import type aiTypes from "@msa/ai/index.types";

import keybindingHints from "../../../modes/interactive/components/keybinding-hints.ts";
import themeModule from "../../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type readContentTypes from "../read-content.types.ts";
import renderUtils from "../render-utils.ts";
import truncate from "../truncate.ts";
import type readRenderTypes from "./read.types.ts";

const { getLanguageFromPath, highlightCode } = themeModule;
const { getTextOutput, replaceTabs, str } = renderUtils;
const { expandHint } = keybindingHints;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } = truncate;

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end--;
  }
  return lines.slice(0, end);
}
function formatReadResult(
  args: readRenderTypes.ReadRenderArgs | undefined,
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

const readResult = { formatReadResult };

export default readResult;
