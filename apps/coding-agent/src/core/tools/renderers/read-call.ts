import keybindingHints from "../../../modes/interactive/components/keybinding-hints.ts";
import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import renderUtils from "../render-utils.ts";
import type readClassificationTypes from "./read-classification.types.ts";
import type readRenderTypes from "./read.types.ts";

const { formatReadLineRange, renderToolPath, str } = renderUtils;
const { keyText } = keybindingHints;

function styledReadLineRange(
  args: readRenderTypes.ReadRenderArgs | undefined,
  theme: themeTypes.Theme,
): string {
  const range = formatReadLineRange(args?.offset, args?.limit);
  return range === "" ? "" : theme.fg("warning", range);
}
function formatReadCall(
  args: readRenderTypes.ReadRenderArgs | undefined,
  theme: themeTypes.Theme,
  cwd: string,
): string {
  const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
  return `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${styledReadLineRange(args, theme)}`;
}
function formatCompactReadCall(
  classification: readClassificationTypes.CompactReadClassification,
  args: readRenderTypes.ReadRenderArgs | undefined,
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
const readCall = { formatCompactReadCall, formatReadCall };

export default readCall;
