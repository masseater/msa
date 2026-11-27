import VirtualTerminal from "../../../libs/tui/test/virtual-terminal.ts";
import KeybindingsManager from "../src/core/keybindings-manager.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
const { getEditorTheme, initTheme, theme } = themeModule;
const { stripAnsi } = ansi;
const renderChat = (container: { render: (width: number) => string[] }): string =>
  stripAnsi(container.render(120).join("\n"));
const tuiKit = {
  KeybindingsManager,
  VirtualTerminal,
  getEditorTheme,
  initTheme,
  renderChat,
  stripAnsi,
  theme,
};

export default tuiKit;
