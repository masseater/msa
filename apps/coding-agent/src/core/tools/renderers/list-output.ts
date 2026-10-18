import { expandHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";

export function formatListResult(
  output: string,
  warnings: string[],
  expanded: boolean,
  noun: string,
  theme: Theme,
): string {
  const lines = output ? output.split("\n") : [];
  if (!expanded) {
    if (lines.length === 0) return "";
    const truncated = warnings.length > 0 ? ", truncated" : "";
    return `\n${expandHint(`${lines.length} ${noun}${truncated}`)}`;
  }
  let text =
    lines.length > 0 ? `\n${lines.map((line) => theme.fg("toolOutput", line)).join("\n")}` : "";
  if (warnings.length > 0)
    text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
  return text;
}
