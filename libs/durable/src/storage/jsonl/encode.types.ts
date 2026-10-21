import type typesModule from "../../types.types.ts";

declare namespace encodeTypes {
  type SidecarState = {
    readonly currentOnlyDocuments: ReadonlySet<typesModule.DocumentId>;
    readonly liveTaskSidecars: ReadonlySet<typesModule.TaskId>;
  };

  type MutableSidecarState = {
    readonly currentOnlyDocuments: Set<typesModule.DocumentId>;
    readonly liveTaskSidecars: Set<typesModule.TaskId>;
  };
}

export type { encodeTypes as default };
