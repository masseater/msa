import type keybindingsModule from "./keybindings.ts";
import type keysTypes from "./keys.types.ts";

declare namespace keybindingsTypes {
  interface KeybindingConflict {
    key: keysTypes.KeyId;
    keybindings: string[];
  }

  type KeybindingsManager = (typeof keybindingsModule.KeybindingsManager)["prototype"];
}

export type { keybindingsTypes as default };
