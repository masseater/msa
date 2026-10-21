import type autocompleteTypesModule from "./autocomplete-types.ts";

declare namespace autocompleteCommandsTypes {
  type CommandEntry =
    | autocompleteTypesModule.SlashCommand
    | autocompleteTypesModule.AutocompleteItem;

  interface CommandQuery {
    commands: readonly CommandEntry[];
    commandText: string;
  }
}

export type { autocompleteCommandsTypes as default };
