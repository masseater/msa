import type keybindingDefinitionsTypes from "../keybinding-definitions.types.ts";
import type keysTypes from "../keys.types.ts";

declare namespace editorKeysTypes {
  type KeyCommand = readonly [keybindingDefinitionsTypes.Keybinding, () => void, keysTypes.KeyId?];
}

export type { editorKeysTypes as default };
