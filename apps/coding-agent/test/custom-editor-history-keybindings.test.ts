import tui from "@msa/tui";
import { afterEach, describe, expect, it } from "vite-plus/test";

import testThemes from "../../../libs/tui/test/test-themes.ts";
import VirtualTerminal from "../../../libs/tui/test/virtual-terminal.ts";
import KeybindingsManager from "../src/core/keybindings-manager.ts";
import CustomEditor from "../src/modes/interactive/components/custom-editor.ts";
const { TuiMainScreen, setKeybindings } = tui;
const { defaultEditorTheme } = testThemes;

afterEach(() => {
  setKeybindings(new KeybindingsManager());
});

const givesAnExplicitHistoryBindingPrecedenceOver = () => {
  const keybindings = new KeybindingsManager({
    "tui.editor.historyNext": "ctrl+n",
    "tui.editor.historyPrevious": "ctrl+p",
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

  editor.handleInput("\x10");
  expect(editor.getText()).toBe("previous prompt");
  expect(modelCycles).toBe(0);

  editor.handleInput("\x0e");
  expect(editor.getText()).toBe("draft");
};

describe("CustomEditor prompt history keybindings", () => {
  it(
    "gives an explicit history binding precedence over model cycling",
    givesAnExplicitHistoryBindingPrecedenceOver,
  );
});
