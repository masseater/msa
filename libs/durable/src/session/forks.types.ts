import type typesModule from "../types.types.ts";

declare namespace forksTypes {
  type ForkDocumentCopy = {
    readonly record: typesModule.DocumentCreate;
    readonly source: typesModule.DocumentCopySource;
  };
}

export type { forksTypes as default };
