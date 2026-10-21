import type { Effect } from "effect";

import type autocompleteTypesModule from "../src/autocomplete-types.ts";

declare namespace editorHelpersTypes {
  interface SettlingProvider {
    readonly provider: autocompleteTypesModule.AutocompleteProvider;
    readonly settled: Effect.Effect<void>;
  }
}

export type { editorHelpersTypes as default };
