import { tmpdir } from "node:os";

import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";

import args from "../src/cli/args.ts";
import authCheck from "../src/cli/auth-check.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import ModelRuntime from "../src/core/model-runtime.ts";
import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
import ReadOnlyAuthStorage from "../src/core/read-only-auth-storage.ts";

const { checkProviderAuth } = authCheck;
const { parseArgs } = args;
const { InMemoryModelsStore } = ai;

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

function createRuntime(
  credentials: authStorageTypes.AuthStorage | authStorageTypes.ReadOnlyAuthStorage,
): Promise<modelRuntimeTypes.ModelRuntime> {
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

const checkOpenaiAuth = (authPath: string) =>
  Effect.gen(function* () {
    const runtime = yield* awaited(createRuntime(new ReadOnlyAuthStorage(authPath)));
    return yield* awaited(checkProviderAuth(parseArgs(["--provider", "openai"]), runtime));
  });

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
  checkOpenaiAuth,
  createRuntime,
  tempDir,
};

export default authCheckSupport;
