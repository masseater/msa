import assert from "node:assert";
import { afterEach, describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import keybindingDefinitions from "../src/keybinding-definitions.ts";
import keybindingsModule from "../src/keybindings.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import testThemes from "./test-themes.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { KeybindingsManager, setKeybindings } = keybindingsModule;
const { TUI_KEYBINDINGS } = keybindingDefinitions;

const { VirtualTerminal } = virtualTerminal;
const { defaultEditorTheme } = testThemes;

afterEach(() => {
  setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
});

describe("Editor prompt history keybindings", () => {
  it("browses history directly without first moving the cursor", () => {
    setKeybindings(
      new KeybindingsManager(TUI_KEYBINDINGS, {
        "tui.editor.historyNext": "ctrl+n",
        "tui.editor.historyPrevious": "ctrl+p",
      }),
    );
    const editor = new Editor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme);
    editor.addToHistory("older prompt");
    editor.addToHistory("newer\nmultiline prompt");
    editor.setText("draft");
    editor.handleInput("\x1b[D");
    editor.handleInput("\x1b[D");

    editor.handleInput("\x10");
    assert.strictEqual(editor.getText(), "newer\nmultiline prompt");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x10");
    assert.strictEqual(editor.getText(), "older prompt");

    editor.handleInput("\x0e");
    assert.strictEqual(editor.getText(), "newer\nmultiline prompt");
    assert.deepStrictEqual(editor.getCursor(), { col: 16, line: 1 });

    editor.handleInput("\x0e");
    assert.strictEqual(editor.getText(), "draft");
    assert.deepStrictEqual(editor.getCursor(), { col: 3, line: 0 });
  });
});
