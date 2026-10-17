import { setKeybindings, TuiMainScreen } from "@msa/tui";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { defaultEditorTheme } from "../../../libs/tui/test/test-themes.ts";
import { VirtualTerminal } from "../../../libs/tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";

afterEach(() => {
  setKeybindings(new KeybindingsManager());
});

describe("CustomEditor prompt history keybindings", () => {
  it("gives an explicit history binding precedence over model cycling", () => {
    const keybindings = new KeybindingsManager({
      "tui.editor.historyPrevious": "ctrl+p",
      "tui.editor.historyNext": "ctrl+n",
    });
    setKeybindings(keybindings);
    const editor = new CustomEditor(
      new TuiMainScreen(new VirtualTerminal()),
      defaultEditorTheme,
      keybindings,
    );
    let modelCycles = 0;
    editor.onAction("app.model.cycleForward", () => {
      modelCycles++;
    });
    editor.addToHistory("previous prompt");
    editor.setText("draft");

    editor.handleInput("\x10"); // Ctrl+P
    expect(editor.getText()).toBe("previous prompt");
    expect(modelCycles).toBe(0);

    editor.handleInput("\x0e"); // Ctrl+N
    expect(editor.getText()).toBe("draft");
  });
});
