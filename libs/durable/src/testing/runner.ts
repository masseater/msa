import { Function } from "effect";

import { createExpectAssertions, type ExpectLike } from "./assertions.ts";
import { createEnvConformance } from "./env-conformance.ts";
import { createStorageConformance } from "./storage-conformance.ts";
import type {
  EnvConformanceOptions,
  EnvConformanceProvider,
  StorageConformanceProvider,
} from "./types.ts";

export interface StorageConformanceRunner {
  readonly describe: (name: string, suite: () => void) => unknown;
  readonly expect: ExpectLike;
  readonly it: (name: string, test: () => Promise<void>, timeoutMs?: number) => unknown;
}

const hasRunner = (args: IArguments): boolean => typeof args[0] !== "string";

export const registerStorageConformance: {
  (
    name: string,
    withStorage: StorageConformanceProvider,
  ): (runner: StorageConformanceRunner) => void;
  (runner: StorageConformanceRunner, name: string, withStorage: StorageConformanceProvider): void;
} = Function.dual(
  hasRunner,
  (runner: StorageConformanceRunner, name: string, withStorage: StorageConformanceProvider) => {
    const cases = createStorageConformance({
      assertions: createExpectAssertions(runner.expect),
      withStorage,
    });
    runner.describe(name, () => {
      for (const testCase of cases) runner.it(testCase.name, testCase.run);
    });
  },
);

type EnvRunnerOptions = Pick<EnvConformanceOptions, "shell" | "symlinks" | "listFiles">;

export const registerEnvConformance: {
  (
    name: string,
    withEnv: EnvConformanceProvider,
    options?: EnvRunnerOptions,
  ): (runner: StorageConformanceRunner) => void;
  (
    runner: StorageConformanceRunner,
    name: string,
    withEnv: EnvConformanceProvider,
    options?: EnvRunnerOptions,
  ): void;
} = Function.dual(
  hasRunner,
  (
    runner: StorageConformanceRunner,
    name: string,
    withEnv: EnvConformanceProvider,
    options: EnvRunnerOptions = {},
  ) => {
    const cases = createEnvConformance({
      ...options,
      assertions: createExpectAssertions(runner.expect),
      withEnv,
    });
    runner.describe(name, () => {
      for (const testCase of cases) runner.it(testCase.name, testCase.run, testCase.timeoutMs);
    });
  },
);
