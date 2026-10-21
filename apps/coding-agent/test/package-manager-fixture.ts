import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";

const { readEnv } = platform;
const { joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

interface PackageManagerFixture {
  tempDir: string;
  agentDir: string;
  settingsManager: settingsManagerTypes.SettingsManager;
  packageManager: packageManagerTypes.DefaultPackageManager;
  useSettings: (settings: Parameters<typeof SettingsManager.inMemory>[0]) => void;
}

const usePackageManagerFixture = (): PackageManagerFixture => {
  let previousOfflineEnv: string | undefined;
  const fixture: PackageManagerFixture = {
    agentDir: "",
    packageManager: undefined as unknown as packageManagerTypes.DefaultPackageManager,
    settingsManager: undefined as unknown as settingsManagerTypes.SettingsManager,
    tempDir: "",
    useSettings: (settings) => {
      fixture.settingsManager = SettingsManager.inMemory(settings);
      fixture.packageManager = new DefaultPackageManager({
        agentDir: fixture.agentDir,
        cwd: fixture.tempDir,
        settingsManager: fixture.settingsManager,
      });
    },
  };

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        previousOfflineEnv = readEnv("MSA_OFFLINE");
        vi.stubEnv("MSA_OFFLINE", undefined);
        fixture.tempDir = yield* makeTempDir("pm-test-");
        fixture.agentDir = joinPath(fixture.tempDir, "agent");
        yield* makeDirectory(fixture.agentDir);
        fixture.useSettings(undefined);
      }),
    ),
  );

  afterEach(() => {
    vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    return runTest(removePath(fixture.tempDir));
  });

  return fixture;
};

const packageManagerFixture = { usePackageManagerFixture };

export default packageManagerFixture;
