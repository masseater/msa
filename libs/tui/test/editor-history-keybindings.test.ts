import assert from "node:assert";
import { afterEach, describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { TUI_KEYBINDINGS } from "../src/keybinding-definitions.ts";
import { KeybindingsManager, setKeybindings } from "../src/keybindings.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

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
