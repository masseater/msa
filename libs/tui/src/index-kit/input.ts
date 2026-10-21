import CombinedAutocompleteProvider from "../autocomplete.ts";
import fuzzy from "../fuzzy.ts";
import keyIds from "../key-ids.ts";
import keyMatchers from "../key-matchers.ts";
import keyProtocols from "../key-protocols.ts";
import keybindingDefinitions from "../keybinding-definitions.ts";
import keybindings from "../keybindings.ts";
import keys from "../keys.ts";
import StdinBuffer from "../stdin-buffer.ts";

const inputKit: {
  readonly CombinedAutocompleteProvider: typeof CombinedAutocompleteProvider;
  readonly StdinBuffer: typeof StdinBuffer;
  readonly fuzzy: typeof fuzzy;
  readonly keyIds: typeof keyIds;
  readonly keyMatchers: typeof keyMatchers;
  readonly keyProtocols: typeof keyProtocols;
  readonly keybindingDefinitions: typeof keybindingDefinitions;
  readonly keybindings: typeof keybindings;
  readonly keys: typeof keys;
} = {
  CombinedAutocompleteProvider,
  StdinBuffer,
  fuzzy,
  keyIds,
  keyMatchers,
  keyProtocols,
  keybindingDefinitions,
  keybindings,
  keys,
};

export default inputKit;
