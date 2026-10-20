import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
const { theme } = themeModule;
const { formatKeyText } = keybindingHints;
const { getKeybindings, visibleWidth, wrapTextWithAnsi } = tui;

export default class TreeHelp implements tuiTypes.Component {
  invalidate(): void {}

  render(width: number): string[] {
    const items = TREE_HELP_ITEMS.map(({ keys, label, labelFirst }) => {
      const text = formatHelpKeys(keys);
      if (text === "") return label;
      return labelFirst === true ? `${label} ${text}` : `${text} ${label}`;
    });

    const availableWidth = Math.max(1, width);
    const indent = "  ";
    const separator = " · ";
    const lines: string[] = [];
    let currentLine = "";

    for (const item of items) {
      const candidate =
        currentLine === ""
          ? visibleWidth(`${indent}${item}`) <= availableWidth
            ? `${indent}${item}`
            : item
          : `${currentLine}${separator}${item}`;
      if (currentLine === "" || visibleWidth(candidate) <= availableWidth) {
        currentLine = candidate;
        continue;
      }

      lines.push(...wrapTextWithAnsi(currentLine.trimEnd(), availableWidth));
      currentLine = visibleWidth(`${indent}${item}`) <= availableWidth ? `${indent}${item}` : item;
    }

    if (currentLine !== "") {
      lines.push(...wrapTextWithAnsi(currentLine.trimEnd(), availableWidth));
    }

    return lines.map((line) => theme.fg("muted", line));
  }
}
const TREE_HELP_ITEMS: Array<{ keys: tuiTypes.Keybinding[]; label: string; labelFirst?: boolean }> =
  [
    { keys: ["tui.select.up", "tui.select.down"], label: "move" },
    { keys: ["tui.editor.cursorLeft", "tui.editor.cursorRight"], label: "page" },
    { keys: ["app.tree.foldOrUp", "app.tree.unfoldOrDown"], label: "branch" },
    { keys: ["app.message.copy"], label: "copy" },
    { keys: ["app.tree.editLabel"], label: "label" },
    { keys: ["app.tree.toggleLabelTimestamp"], label: "label time" },
    {
      keys: [
        "app.tree.filter.default",
        "app.tree.filter.noTools",
        "app.tree.filter.userOnly",
        "app.tree.filter.labeledOnly",
        "app.tree.filter.all",
      ],
      label: "filters",
      labelFirst: true,
    },
    {
      keys: ["app.tree.filter.cycleForward", "app.tree.filter.cycleBackward"],
      label: "cycle",
      labelFirst: true,
    },
  ];
function formatHelpKeys(keybindings: tuiTypes.Keybinding[]): string {
  const keys: string[] = [];
  for (const keybinding of keybindings) {
    const key = getKeybindings().getKeys(keybinding)[0];
    if (key !== undefined) keys.push(key);
  }
  if (keys.length === 0) return "";

  return formatKeyText(compactRawKeys(keys))
    .replace(/\bpageUp\b/gu, "pgup")
    .replace(/\bpageDown\b/gu, "pgdn")
    .replace(/\bup\b/gu, "↑")
    .replace(/\bdown\b/gu, "↓")
    .replace(/\bleft\b/gu, "←")
    .replace(/\bright\b/gu, "→");
}
function compactRawKeys(keys: string[]): string {
  if (keys.length === 1) return keys[0]!;

  const parts = keys.map((key) => {
    const separatorIndex = key.lastIndexOf("+");
    return separatorIndex === -1
      ? { prefix: "", suffix: key }
      : { prefix: key.slice(0, separatorIndex + 1), suffix: key.slice(separatorIndex + 1) };
  });
  const prefix = parts[0]!.prefix;
  return prefix !== "" && parts.every((part) => part.prefix === prefix)
    ? `${prefix}${parts.map((part) => part.suffix).join("/")}`
    : keys.join("/");
}
