import type { AutocompleteItem } from "@msa/tui";

import type { ExtensionCommandContext } from "../../core/extensions/types.ts";

/** One kind of account `/accounts <kind> ...` manages. */
export interface AccountKind {
  name: string;
  description: string;
  /** The kind's accounts and their state. */
  describe(): Promise<string>;
  /** Run `<action> ...` (empty: list); show the result through `ctx.ui`. */
  run(args: string, ctx: ExtensionCommandContext): Promise<void>;
  /** Completions for the text after the kind name; values exclude the kind. */
  complete(prefix: string): AutocompleteItem[] | null;
}
