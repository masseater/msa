import type typesModule from "./types.types.ts";

declare namespace promptTypes {
  type SystemDraft = typesModule.TypedEntryDraft<never>;
}

export type { promptTypes as default };
