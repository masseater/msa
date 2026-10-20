import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "./extensions/types.types.ts";

declare namespace accountsTypes {
  interface AccountsContext {
    ui: Pick<extensionsTypesTypes.ExtensionUIContext, "notify" | "input" | "confirm">;

    refreshProviders(): Promise<void>;
  }

  interface AccountKind {
    name: string;
    description: string;

    describe(): Promise<string>;

    run(args: string, ctx: AccountsContext): Promise<void>;

    complete(prefix: string): tuiTypes.AutocompleteItem[] | null;
  }
}

export type { accountsTypes as default };
