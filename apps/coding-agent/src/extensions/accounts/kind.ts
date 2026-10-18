import type { AutocompleteItem } from "@msa/tui";

import type { ExtensionCommandContext } from "../../core/extensions/types.ts";

export interface AccountKind {
  name: string;
  description: string;

  describe(): Promise<string>;

  run(args: string, ctx: ExtensionCommandContext): Promise<void>;

  complete(prefix: string): AutocompleteItem[] | null;
}
