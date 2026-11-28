import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";

import args from "../src/cli/args.ts";
import authCheck from "../src/cli/auth-check.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import ModelRuntime from "../src/core/model-runtime.ts";
import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
import ReadOnlyAuthStorage from "../src/core/read-only-auth-storage.ts";
import tempDirModule from "./temp-dir.ts";

const { checkProviderAuth } = authCheck;
const { useTempDir } = tempDirModule;
const { parseArgs } = args;
const { InMemoryModelsStore } = ai;

const { awaited, runTest } = testing;

const authDir = useTempDir("msa-test-auth-check-");

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

const authCheckSupport = {
  authDir,
  checkOpenaiAuth,
  createRuntime,
};

export default authCheckSupport;
