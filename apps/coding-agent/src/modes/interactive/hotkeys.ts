import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../core/extensions/index.types.ts";
import keybindingHints from "./components/keybinding-hints.ts";

const { formatKeyText, keyDisplayText } = keybindingHints;

type Row = readonly [keys: readonly tuiTypes.Keybinding[] | string, action: string];

const NEW_LINE_ACTION =
  process.platform === "win32" ? "New line (Ctrl+Enter on Windows Terminal)" : "New line";

const SECTIONS: ReadonlyArray<readonly [title: string, rows: readonly Row[]]> = [
  [
    "Navigation",
    [
      [
        [
          "tui.editor.cursorUp",
          "tui.editor.cursorDown",
          "tui.editor.cursorLeft",
          "tui.editor.cursorRight",
        ],
        "Move cursor / browse history",
      ],
      [["tui.editor.cursorWordLeft", "tui.editor.cursorWordRight"], "Move by word"],
      [["tui.editor.cursorLineStart"], "Start of line"],
      [["tui.editor.cursorLineEnd"], "End of line"],
      [["tui.editor.jumpForward"], "Jump forward to character"],
      [["tui.editor.jumpBackward"], "Jump backward to character"],
      [["tui.editor.pageUp", "tui.editor.pageDown"], "Scroll by page"],
    ],
  ],
  [
    "Editing",
    [
      [["tui.input.submit"], "Send message"],
      [["tui.input.newLine"], NEW_LINE_ACTION],
      [["tui.editor.deleteWordBackward"], "Delete word backwards"],
      [["tui.editor.deleteWordForward"], "Delete word forwards"],
      [["tui.editor.deleteToLineStart"], "Delete to start of line"],
      [["tui.editor.deleteToLineEnd"], "Delete to end of line"],
      [["tui.editor.yank"], "Paste the most-recently-deleted text"],
      [["tui.editor.yankPop"], "Cycle through the deleted text after pasting"],
      [["tui.editor.undo"], "Undo"],
    ],
  ],
  [
    "Other",
    [
      [["tui.input.tab"], "Path completion / accept autocomplete"],
      [["app.interrupt"], "Cancel autocomplete / abort streaming"],
      [["app.clear"], "Clear editor (first) / exit (second)"],
      [["app.exit"], "Exit (when editor is empty)"],
      [["app.suspend"], "Suspend to background"],
      [["app.thinking.cycle"], "Cycle thinking level"],
      [["app.model.cycleForward", "app.model.cycleBackward"], "Cycle models"],
      [["app.model.select"], "Open model selector"],
      [["app.tools.expand"], "Toggle tool output expansion"],
      [["app.thinking.toggle"], "Toggle thinking block visibility"],
      [["app.editor.external"], "Edit message in external editor"],
      [["app.message.copy"], "Copy selection or last assistant message"],
      [["app.message.followUp"], "Queue follow-up message"],
      [["app.message.dequeue"], "Restore queued messages"],
      [["app.clipboard.pasteImage"], "Paste files on macOS, images, or text from clipboard"],
      ["/", "Slash commands"],
      ["!", "Run bash command"],
      ["!!", "Run bash command (excluded from context)"],
    ],
  ],
];

const keyCell = (keys: readonly string[]): string => keys.map((key) => `\`${key}\``).join(" / ");

function table(
  title: string,
  rows: ReadonlyArray<readonly [keys: string[], action: string]>,
): string {
  const body = rows.map(([keys, action]) => `| ${keyCell(keys)} | ${action} |`).join("\n");
  return `**${title}**\n| Key | Action |\n|-----|--------|\n${body}`;
}

function formatHotkeysMarkdown(
  extensionShortcuts: ReadonlyMap<string, extensionsTypes.ExtensionShortcut>,
): string {
  const sections = SECTIONS.map(([title, rows]) =>
    table(
      title,
      rows.map(([keys, action]) => [
        typeof keys === "string" ? [keys] : keys.map((key) => keyDisplayText(key)),
        action,
      ]),
    ),
  );
  if (extensionShortcuts.size > 0) {
    sections.push(
      table(
        "Extensions",
        [...extensionShortcuts].map(([key, shortcut]) => [
          [formatKeyText(key, { capitalize: true })],
          shortcut.description ?? shortcut.extensionPath,
        ]),
      ),
    );
  }
  return sections.join("\n\n");
}

const hotkeys = {
  formatHotkeysMarkdown,
};

export default hotkeys;
