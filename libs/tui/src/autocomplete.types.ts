import type autocompleteTypesModule from "./autocomplete-types.ts";
import type CombinedAutocompleteProviderClass from "./autocomplete.ts";

declare namespace autocompleteTypes {
  type AutocompleteItem = autocompleteTypesModule.AutocompleteItem;

  type AutocompleteProvider = autocompleteTypesModule.AutocompleteProvider;

  type AutocompleteSuggestions = autocompleteTypesModule.AutocompleteSuggestions;

  type SlashCommand = autocompleteTypesModule.SlashCommand;

  type CombinedAutocompleteProvider = CombinedAutocompleteProviderClass;
}

export type { autocompleteTypes as default };
