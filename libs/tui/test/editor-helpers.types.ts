import type { Effect } from "effect";

import type { AutocompleteProvider } from "../src/autocomplete-types.ts";

declare namespace editorHelpersTypes {
  interface SettlingProvider {
    readonly provider: AutocompleteProvider;
    readonly settled: Effect.Effect<void>;
  }
}

export type { editorHelpersTypes as default };
