import { Function } from "effect";

import assertionsModule from "./assertions.ts";
import envConformance from "./env-conformance.ts";
import type runnerTypes from "./runner.types.ts";
import storageConformance from "./storage-conformance.ts";
import type typesModule from "./types.ts";

const { createStorageConformance } = storageConformance;
const { createExpectAssertions } = assertionsModule;
const { createEnvConformance } = envConformance;

const hasRunner = (args: IArguments): boolean => typeof args[0] !== "string";

const registerStorageConformance: {
  (
    name: string,
    withStorage: typesModule.StorageConformanceProvider,
  ): (runner: runnerTypes.StorageConformanceRunner) => void;
  (
    runner: runnerTypes.StorageConformanceRunner,
    name: string,
    withStorage: typesModule.StorageConformanceProvider,
  ): void;
} = Function.dual(
  hasRunner,
  (
    runner: runnerTypes.StorageConformanceRunner,
    name: string,
    withStorage: typesModule.StorageConformanceProvider,
  ) => {
    const cases = createStorageConformance({
      assertions: createExpectAssertions(runner.expect),
      withStorage,
    });
    runner.describe(name, () => {
      for (const testCase of cases) runner.it(testCase.name, testCase.run);
    });
  },
);

type EnvRunnerOptions = Pick<typesModule.EnvConformanceOptions, "shell" | "symlinks" | "listFiles">;

const registerEnvConformance: {
  (
    name: string,
    withEnv: typesModule.EnvConformanceProvider,
    options?: EnvRunnerOptions,
  ): (runner: runnerTypes.StorageConformanceRunner) => void;
  (
    runner: runnerTypes.StorageConformanceRunner,
    name: string,
    withEnv: typesModule.EnvConformanceProvider,
    options?: EnvRunnerOptions,
  ): void;
} = Function.dual(
  hasRunner,
  (
    runner: runnerTypes.StorageConformanceRunner,
    name: string,
    withEnv: typesModule.EnvConformanceProvider,
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

const runnerModule = {
  registerEnvConformance,
  registerStorageConformance,
};

export default runnerModule;
