import type keysTypes from "./keys.types.ts";

declare global {
  interface MsaTuiKeybindings {}
}

declare namespace keybindingDefinitionsTypes {
  interface Keybindings extends MsaTuiKeybindings {
    "tui.editor.cursorUp": true;
    "tui.editor.cursorDown": true;
    "tui.editor.historyPrevious": true;
    "tui.editor.historyNext": true;
    "tui.editor.cursorLeft": true;
    "tui.editor.cursorRight": true;
    "tui.editor.cursorWordLeft": true;
    "tui.editor.cursorWordRight": true;
    "tui.editor.cursorLineStart": true;
    "tui.editor.cursorLineEnd": true;
    "tui.editor.jumpForward": true;
    "tui.editor.jumpBackward": true;
    "tui.editor.pageUp": true;
    "tui.editor.pageDown": true;
    "tui.editor.deleteCharBackward": true;
    "tui.editor.deleteCharForward": true;
    "tui.editor.deleteWordBackward": true;
    "tui.editor.deleteWordForward": true;
    "tui.editor.deleteToLineStart": true;
    "tui.editor.deleteToLineEnd": true;
    "tui.editor.yank": true;
    "tui.editor.yankPop": true;
    "tui.editor.undo": true;
    "tui.input.newLine": true;
    "tui.input.submit": true;
    "tui.input.tab": true;
    "tui.input.copy": true;
    "tui.select.up": true;
    "tui.select.down": true;
    "tui.select.pageUp": true;
    "tui.select.pageDown": true;
    "tui.select.confirm": true;
    "tui.select.cancel": true;
    "tui.altScreen.pageUp": true;
    "tui.altScreen.pageDown": true;
    "tui.altScreen.halfPageUp": true;
    "tui.altScreen.halfPageDown": true;
    "tui.altScreen.lineUp": true;
    "tui.altScreen.lineDown": true;
    "tui.altScreen.previousPrompt": true;
    "tui.altScreen.nextPrompt": true;
    "tui.altScreen.search": true;
    "tui.altScreen.searchNext": true;
    "tui.altScreen.searchPrevious": true;
    "tui.altScreen.searchClose": true;
    "tui.altScreen.top": true;
    "tui.altScreen.bottom": true;
  }

  type Keybinding = keyof Keybindings;

  interface KeybindingDefinition {
    defaultKeys: keysTypes.KeyId | keysTypes.KeyId[];
    description?: string;
  }

  type KeybindingDefinitions = Record<string, KeybindingDefinition>;

  type KeybindingsConfig = Record<string, keysTypes.KeyId | keysTypes.KeyId[] | undefined>;
}

export type { keybindingDefinitionsTypes as default };
