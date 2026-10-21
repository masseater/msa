import testing from "@msa/testing";
import { afterEach, beforeEach, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import providerAuth from "../src/core/provider-composer/provider-auth.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { clearApiKeyCache } = providerAuth;
const { createModelRegistry } = modelRuntimeTestUtils;
const { joinPath, makeTempDir, randomSuffixSync, removePath, runTest } = testing;

interface ModelRegistryFixture {
  tempDir: string;
  modelsJsonPath: string;
  authStorage: authStorageTypes.AuthStorage;
  createRegistry: () => ReturnType<typeof createModelRegistry>;
}

const useModelRegistryFixture = (): ModelRegistryFixture => {
  const fixture: ModelRegistryFixture = {
    authStorage: AuthStorage.inMemory(),
    createRegistry: () => createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
    modelsJsonPath: "",
    tempDir: "",
  };

  beforeEach(() =>
    runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
      fixture.tempDir = dir;
      fixture.modelsJsonPath = joinPath(dir, "models.json");
      fixture.authStorage = AuthStorage.inMemory();
      return dir;
    }),
  );

  afterEach(() => {
    clearApiKeyCache();
    vi.restoreAllMocks();
    return runTest(removePath(fixture.tempDir));
  });

  return fixture;
};

const modelRegistryFixture = { useModelRegistryFixture };

export default modelRegistryFixture;
