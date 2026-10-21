import type durableTypes from "@msa/durable/index.types";

declare namespace jsonStorageTypes {
  interface OpenedStorage {
    readonly storage: durableTypes.Storage;
    readonly location: string | undefined;
  }
}

export type { jsonStorageTypes as default };
