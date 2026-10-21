import type autocompleteTypesModule from "../autocomplete-types.ts";
import type autocompleteTypes from "../autocomplete.types.ts";
import type editorComponentTypes from "../editor-component.ts";
import type fuzzyTypes from "../fuzzy.types.ts";
import type keyIdsTypes from "../key-ids.types.ts";
import type keyProtocolsTypes from "../key-protocols.types.ts";
import type keybindingDefinitionsTypes from "../keybinding-definitions.types.ts";
import type keybindingsTypes from "../keybindings.types.ts";
import type stdinBufferTypes from "../stdin-buffer.types.ts";

declare namespace tuiInputKitTypes {
  type AutocompleteItem = autocompleteTypesModule.AutocompleteItem;
  type AutocompleteProvider = autocompleteTypesModule.AutocompleteProvider;
  type AutocompleteSuggestions = autocompleteTypesModule.AutocompleteSuggestions;
  type SlashCommand = autocompleteTypesModule.SlashCommand;
  type EditorComponent = editorComponentTypes.EditorComponent;
  type FuzzyMatch = fuzzyTypes.FuzzyMatch;
  type Keybinding = keybindingDefinitionsTypes.Keybinding;
  type KeybindingDefinition = keybindingDefinitionsTypes.KeybindingDefinition;
  type KeybindingDefinitions = keybindingDefinitionsTypes.KeybindingDefinitions;
  type Keybindings = keybindingDefinitionsTypes.Keybindings;
  type KeybindingsConfig = keybindingDefinitionsTypes.KeybindingsConfig;
  type KeybindingConflict = keybindingsTypes.KeybindingConflict;
  type KeyEventType = keyProtocolsTypes.KeyEventType;
  type KeyId = keyIdsTypes.KeyId;
  type StdinBufferEventMap = stdinBufferTypes.StdinBufferEventMap;
  type StdinBufferOptions = stdinBufferTypes.StdinBufferOptions;
  type KeybindingsManager = keybindingsTypes.KeybindingsManager;
  type StdinBuffer = stdinBufferTypes.StdinBuffer;
  type CombinedAutocompleteProvider = autocompleteTypes.CombinedAutocompleteProvider;
}

export type { tuiInputKitTypes as default };
