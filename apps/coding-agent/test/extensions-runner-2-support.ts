import KeybindingsManager from "../src/core/keybindings-manager.ts";

const defaultKeybindings = new KeybindingsManager().getEffectiveConfig();

const extensionsRunner2Support = {
  defaultKeybindings,
};

export default extensionsRunner2Support;
