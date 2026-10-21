import type assertionsTypes from "./assertions.types.ts";

declare namespace runnerTypes {
  interface StorageConformanceRunner {
    readonly describe: (name: string, suite: () => void) => unknown;
    readonly expect: assertionsTypes.ExpectLike;
    readonly it: (name: string, test: () => Promise<void>, timeoutMs?: number) => unknown;
  }
}

export type { runnerTypes as default };
