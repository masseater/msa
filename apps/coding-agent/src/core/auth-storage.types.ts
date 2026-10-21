import type aiTypes from "@msa/ai/index.types";

import type AuthStorageClass from "./auth-storage.ts";
import type FileAuthStorageBackendClass from "./file-auth-storage-backend.ts";
import type InMemoryAuthStorageBackendClass from "./in-memory-auth-storage-backend.ts";
import type ReadOnlyAuthStorageClass from "./read-only-auth-storage.ts";

declare namespace authStorageTypes {
  type LockResult<T> = {
    result: T;
    next?: string;
  };

  interface AuthStorageBackend {
    withLockAsync<T>(
      fn: (current: string | undefined) => Promise<LockResult<T>>,
      options?: aiTypes.AuthOperationOptions,
    ): Promise<T>;
  }

  type FileAuthStorageBackend = (typeof FileAuthStorageBackendClass)["prototype"];

  type ReadOnlyAuthStorage = (typeof ReadOnlyAuthStorageClass)["prototype"];

  type InMemoryAuthStorageBackend = (typeof InMemoryAuthStorageBackendClass)["prototype"];

  type AuthStorage = (typeof AuthStorageClass)["prototype"];
}

export type { authStorageTypes as default };
