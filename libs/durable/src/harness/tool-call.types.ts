import type typesModule from "./types.types.ts";

declare namespace toolCallTypes {
  type Checked = { readonly args: typesModule.JsonObject } | { readonly error: string };
}

export type { toolCallTypes as default };
