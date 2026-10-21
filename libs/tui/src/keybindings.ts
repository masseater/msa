import keybindingDefinitions from "./keybinding-definitions.ts";
import KeybindingsManager from "./keybindings-manager.ts";

const { TUI_KEYBINDINGS } = keybindingDefinitions;

let globalKeybindings: KeybindingsManager | null = null;

function setKeybindings(keybindings: KeybindingsManager): void {
  globalKeybindings = keybindings;
}

function getKeybindings(): KeybindingsManager {
  if (globalKeybindings === null) {
    globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  }
  return globalKeybindings;
}

const keybindingsModule = {
  KeybindingsManager,
  getKeybindings,
  setKeybindings,
};

export default keybindingsModule;
