import TruncatedText from "./components/truncated-text.ts";
import VStack from "./components/v-stack.ts";
import fuzzy from "./fuzzy.ts";
import keyIds from "./key-ids.ts";
import keyMatchers from "./key-matchers.ts";
import keyProtocols from "./key-protocols.ts";
import keybindingDefinitions from "./keybinding-definitions.ts";
import keybindings from "./keybindings.ts";
import keys from "./keys.ts";

const indexKitPart3: {
  readonly TruncatedText: typeof TruncatedText;
  readonly VStack: typeof VStack;
  readonly fuzzy: typeof fuzzy;
  readonly keyIds: typeof keyIds;
  readonly keyMatchers: typeof keyMatchers;
  readonly keyProtocols: typeof keyProtocols;
  readonly keybindingDefinitions: typeof keybindingDefinitions;
  readonly keybindings: typeof keybindings;
  readonly keys: typeof keys;
} = {
  TruncatedText,
  VStack,
  fuzzy,
  keyIds,
  keyMatchers,
  keyProtocols,
  keybindingDefinitions,
  keybindings,
  keys,
};

export default indexKitPart3;
