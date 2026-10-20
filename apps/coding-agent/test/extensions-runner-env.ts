import testing from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

const { createInMemoryModelRegistry } = modelRuntimeTestUtils;

const env = {
  extensionsDir: "",
  modelRegistry: undefined as unknown as ModelRegistry,
  sessionManager: SessionManager.inMemory(),
  tempDir: "",
};

const prepareRunnerEnv = Effect.gen(function* () {
  env.tempDir = yield* makeTempDir("msa-runner-test-");
  env.extensionsDir = joinPath(env.tempDir, "extensions");
  yield* makeDirectory(env.extensionsDir);
  env.sessionManager = SessionManager.inMemory();
  env.modelRegistry = yield* awaited(createInMemoryModelRegistry(AuthStorage.inMemory()));
});

const cleanupRunnerEnv = () => runTest(removePath(env.tempDir));

const extensionsRunnerEnv = {
  cleanupRunnerEnv,
  env,
  prepareRunnerEnv,
};

export default extensionsRunnerEnv;
