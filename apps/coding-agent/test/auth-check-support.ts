import { tmpdir } from "node:os";

import { InMemoryModelsStore } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage, ReadOnlyAuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  removePath,
  runTest,
} = testing;

const tempDir = joinPath(
  tmpdir(),
  `msa-test-auth-check-${currentTimeMillis()}-${randomSuffixSync()}`,
);

function createRuntime(credentials: AuthStorage | ReadOnlyAuthStorage): Promise<ModelRuntime> {
  return runTest(
    awaited(
      ModelRuntime.create({
        allowModelNetwork: false,
        credentials,
        modelsPath: null,
        modelsStore: new InMemoryModelsStore(),
        refreshOnCreate: false,
      }),
    ),
  );
}

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (yield* pathExists(tempDir)) yield* removePath(tempDir);
      yield* makeDirectory(tempDir);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (yield* pathExists(tempDir)) yield* removePath(tempDir);
    }),
  );

const authCheckSupport = {
  afterEachHook,
  beforeEachHook,
  createRuntime,
  tempDir,
};

export default authCheckSupport;
