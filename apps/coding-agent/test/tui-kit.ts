import { VirtualTerminal } from "../../../libs/tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { getEditorTheme, initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const tuiKit = {
  KeybindingsManager,
  VirtualTerminal,
  getEditorTheme,
  initTheme,
  stripAnsi,
  theme,
};

export default tuiKit;
