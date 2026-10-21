import type typesModule from "./types.types.ts";
import type viewTypesModule from "./view-types.ts";

declare namespace viewMountTypes {
  type Mount = {
    value: viewTypesModule.ConversationView;
    readonly docs: Map<string, { id: typesModule.DocumentId; version: number }>;
    readonly observers: Set<viewTypesModule.ViewObserver>;
  };

  type MountedEntries = readonly typesModule.EntryRecord[];
}

export type { viewMountTypes as default };
