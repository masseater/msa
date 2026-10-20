import type { Storage } from "@msa/durable";

declare namespace jsonStorageTypes {
  interface OpenedStorage {
    readonly storage: Storage;
    readonly location: string | undefined;
  }
}

export type { jsonStorageTypes as default };
