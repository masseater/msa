import tui from "@msa/tui";

import virtualTerminal from "../../../libs/tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { EditorSlot } from "../src/modes/interactive/editor-slot.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

const { Container, Editor, TuiMainScreen, getKeybindings, setKeybindings } = tui;
const { VirtualTerminal } = virtualTerminal;

const prepareTheme = (): void => {
  initTheme("dark");
};

const createEditorSlotUi = () => {
  const previousKeybindings = getKeybindings();
  const keybindings = new KeybindingsManager();
  setKeybindings(keybindings);
  const ui = new TuiMainScreen(new VirtualTerminal());
  const container = new Container();
  const editor = new Editor(ui, getEditorTheme());
  const editorSlot = new EditorSlot(container, ui, () => editor);
  const restoreKeybindings = () => setKeybindings(previousKeybindings);
  return { container, editor, editorSlot, keybindings, restoreKeybindings, ui };
};

const editorSlotUi = {
  createEditorSlotUi,
  prepareTheme,
};

export default editorSlotUi;
