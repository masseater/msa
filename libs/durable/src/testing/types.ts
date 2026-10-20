import type envTypes from "../env/index.types.ts";
import type typesModuleModule from "../types.types.ts";

declare namespace typesModule {
  interface StorageConformanceAssertions {
    ok(value: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown): void;
    deepEqual(actual: unknown, expected: unknown): void;
    partialDeepEqual(actual: unknown, expected: unknown): void;
    greaterThan(actual: number, expected: number): void;
    rejects(operation: Promise<unknown>, messageIncludes: string): Promise<void>;
  }

  type StorageConformanceProvider = (
    use: (storage: typesModuleModule.Storage) => Promise<void>,
  ) => Promise<void>;

  interface StorageConformanceOptions {
    readonly assertions: StorageConformanceAssertions;
    readonly withStorage: StorageConformanceProvider;
  }

  interface StorageConformanceCase {
    readonly name: string;
    run(): Promise<void>;
  }

  type EnvConformanceAssertions = StorageConformanceAssertions;

  type EnvConformanceProvider = (
    use: (env: envTypes.ExecutionEnv) => Promise<void>,
  ) => Promise<void>;

  interface EnvConformanceOptions {
    readonly assertions: EnvConformanceAssertions;
    readonly withEnv: EnvConformanceProvider;
    readonly shell?: readonly string[];
    readonly symlinks?: boolean;
    readonly listFiles?: boolean;
  }

  interface EnvConformanceCase {
    readonly name: string;
    readonly timeoutMs?: number;
    run(): Promise<void>;
  }
}

export type { typesModule as default };
