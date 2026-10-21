import type GuardedStorageClass from "./guarded-storage.ts";

declare namespace guardedStorageTypes {
  type FailureLatch = {
    readonly failure: { readonly error: unknown } | undefined;
    fail(error: unknown): void;
  };

  type GuardedStorage = GuardedStorageClass;
}

export type { guardedStorageTypes as default };
