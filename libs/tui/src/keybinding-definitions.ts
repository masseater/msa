import type keybindingDefinitionsTypes from "./keybinding-definitions.types.ts";

const TUI_KEYBINDINGS = {
  "tui.altScreen.bottom": { defaultKeys: "ctrl+end", description: "Scroll viewport to bottom" },
  "tui.altScreen.halfPageDown": {
    defaultKeys: [],
    description: "Scroll viewport down half a page",
  },
  "tui.altScreen.halfPageUp": {
    defaultKeys: [],
    description: "Scroll viewport up half a page",
  },
  "tui.altScreen.lineDown": {
    defaultKeys: [],
    description: "Scroll viewport down one line",
  },
  "tui.altScreen.lineUp": {
    defaultKeys: [],
    description: "Scroll viewport up one line",
  },
  "tui.altScreen.nextPrompt": {
    defaultKeys: ["ctrl+shift+down", "ctrl+down"],
    description: "Jump to next semantic prompt",
  },
  "tui.altScreen.pageDown": {
    defaultKeys: "pageDown",
    description: "Scroll viewport down one page",
  },
  "tui.altScreen.pageUp": {
    defaultKeys: "pageUp",
    description: "Scroll viewport up one page",
  },
  "tui.altScreen.previousPrompt": {
    defaultKeys: ["ctrl+shift+up", "ctrl+up"],
    description: "Jump to previous semantic prompt",
  },
  "tui.altScreen.search": {
    defaultKeys: "ctrl+shift+f",
    description: "Search the primary scroll view",
  },
  "tui.altScreen.searchClose": {
    defaultKeys: "escape",
    description: "Close transcript search",
  },
  "tui.altScreen.searchNext": {
    defaultKeys: ["enter", "ctrl+g"],
    description: "Select the next search match",
  },
  "tui.altScreen.searchPrevious": {
    defaultKeys: ["shift+enter", "ctrl+shift+g"],
    description: "Select the previous search match",
  },
  "tui.altScreen.top": { defaultKeys: "ctrl+home", description: "Scroll viewport to top" },
  "tui.editor.cursorDown": { defaultKeys: "down", description: "Move cursor down" },
  "tui.editor.cursorLeft": {
    defaultKeys: ["left", "ctrl+b"],
    description: "Move cursor left",
  },
  "tui.editor.cursorLineEnd": {
    defaultKeys: ["end", "ctrl+e"],
    description: "Move to line end",
  },
  "tui.editor.cursorLineStart": {
    defaultKeys: ["home", "ctrl+a"],
    description: "Move to line start",
  },
  "tui.editor.cursorRight": {
    defaultKeys: ["right", "ctrl+f"],
    description: "Move cursor right",
  },
  "tui.editor.cursorUp": { defaultKeys: "up", description: "Move cursor up" },
  "tui.editor.cursorWordLeft": {
    defaultKeys: ["alt+left", "ctrl+left", "alt+b"],
    description: "Move cursor word left",
  },
  "tui.editor.cursorWordRight": {
    defaultKeys: ["alt+right", "ctrl+right", "alt+f"],
    description: "Move cursor word right",
  },
  "tui.editor.deleteCharBackward": {
    defaultKeys: "backspace",
    description: "Delete character backward",
  },
  "tui.editor.deleteCharForward": {
    defaultKeys: ["delete", "ctrl+d"],
    description: "Delete character forward",
  },
  "tui.editor.deleteToLineEnd": {
    defaultKeys: "ctrl+k",
    description: "Delete to line end",
  },
  "tui.editor.deleteToLineStart": {
    defaultKeys: "ctrl+u",
    description: "Delete to line start",
  },
  "tui.editor.deleteWordBackward": {
    defaultKeys: ["ctrl+w", "alt+backspace"],
    description: "Delete word backward",
  },
  "tui.editor.deleteWordForward": {
    defaultKeys: ["alt+d", "alt+delete"],
    description: "Delete word forward",
  },
  "tui.editor.historyNext": {
    defaultKeys: [],
    description: "Select next prompt history entry",
  },
  "tui.editor.historyPrevious": {
    defaultKeys: [],
    description: "Select previous prompt history entry",
  },
  "tui.editor.jumpBackward": {
    defaultKeys: "ctrl+alt+]",
    description: "Jump backward to character",
  },
  "tui.editor.jumpForward": {
    defaultKeys: "ctrl+]",
    description: "Jump forward to character",
  },
  "tui.editor.pageDown": { defaultKeys: ["pageDown", "ctrl+pageDown"], description: "Page down" },
  "tui.editor.pageUp": { defaultKeys: ["pageUp", "ctrl+pageUp"], description: "Page up" },
  "tui.editor.undo": { defaultKeys: "ctrl+-", description: "Undo" },
  "tui.editor.yank": { defaultKeys: "ctrl+y", description: "Yank" },
  "tui.editor.yankPop": { defaultKeys: "alt+y", description: "Yank pop" },
  "tui.input.copy": { defaultKeys: "ctrl+c", description: "Copy selection" },
  "tui.input.newLine": { defaultKeys: ["shift+enter", "ctrl+j"], description: "Insert newline" },
  "tui.input.submit": { defaultKeys: "enter", description: "Submit input" },
  "tui.input.tab": { defaultKeys: "tab", description: "Tab / autocomplete" },
  "tui.select.cancel": {
    defaultKeys: ["escape", "ctrl+c"],
    description: "Cancel selection",
  },
  "tui.select.confirm": { defaultKeys: "enter", description: "Confirm selection" },
  "tui.select.down": { defaultKeys: "down", description: "Move selection down" },
  "tui.select.pageDown": {
    defaultKeys: "pageDown",
    description: "Selection page down",
  },
  "tui.select.pageUp": { defaultKeys: "pageUp", description: "Selection page up" },
  "tui.select.up": { defaultKeys: "up", description: "Move selection up" },
} as const satisfies keybindingDefinitionsTypes.KeybindingDefinitions;

const keybindingDefinitions = {
  TUI_KEYBINDINGS,
};

export default keybindingDefinitions;
