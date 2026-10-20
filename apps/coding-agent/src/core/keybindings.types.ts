import type tuiTypes from "@msa/tui/index.types";

import type KeybindingsManagerClass from "./keybindings-manager.ts";
import type keybindings from "./keybindings.ts";

declare namespace keybindingsTypes {
  type AppKeybinding = keyof typeof keybindings.APP_KEYBINDINGS;

  type AppKeybindings = { [K in AppKeybinding]: true };

  type Keybinding = tuiTypes.Keybinding;

  type KeybindingsConfig = tuiTypes.KeybindingsConfig;

  type KeyId = tuiTypes.KeyId;

  type KeybindingsManager = (typeof KeybindingsManagerClass)["prototype"];
}

export type { keybindingsTypes as default };
