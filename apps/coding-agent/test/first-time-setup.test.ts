import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { shouldRunFirstTimeSetup } from "../src/cli/startup-ui.ts";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const { joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

const originalMsaExperimental = readEnv("MSA_EXPERIMENTAL");

const originalAgentDir = readEnv(ENV_AGENT_DIR);

let tempDir: string;

let settingsPath: string;

const returnsTrueWhenExperimentalDefaultAgentDir = () => {
  expect(shouldRunFirstTimeSetup(settingsPath)).toBe(true);
};

const returnsFalseWhenExperimentalFeaturesAreDisabled = () => {
  deleteEnv("MSA_EXPERIMENTAL");

  expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
};

const returnsFalseWhenACustomAgentDir = () => {
  writeEnv(ENV_AGENT_DIR, tempDir);

  expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
};

const returnsFalseWhenSettingsJsonAlreadyExists = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(settingsPath, "{}");
      expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-first-time-setup-");
      settingsPath = joinPath(tempDir, "settings.json");
      writeEnv("MSA_EXPERIMENTAL", "1");
      deleteEnv(ENV_AGENT_DIR);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      yield* removePath(tempDir);
      if (originalMsaExperimental === undefined) {
        deleteEnv("MSA_EXPERIMENTAL");
      } else {
        writeEnv("MSA_EXPERIMENTAL", originalMsaExperimental);
      }
      if (originalAgentDir === undefined) {
        deleteEnv(ENV_AGENT_DIR);
      } else {
        writeEnv(ENV_AGENT_DIR, originalAgentDir);
      }
    }),
  );

describe("shouldRunFirstTimeSetup", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "returns true when experimental, default agent dir, and no settings.json",
    returnsTrueWhenExperimentalDefaultAgentDir,
  );

  it(
    "returns false when experimental features are disabled",
    returnsFalseWhenExperimentalFeaturesAreDisabled,
  );

  it("returns false when a custom agent dir is set", returnsFalseWhenACustomAgentDir);

  it("returns false when settings.json already exists", returnsFalseWhenSettingsJsonAlreadyExists);
});

const defaultsToDisabledWithNoTrackingIdentifier = () => {
  const manager = SettingsManager.inMemory();

  expect(manager.getEnableAnalytics()).toBe(false);
  expect(manager.getTrackingId()).toBeUndefined();
};

const generatesATrackingIdentifierOnOptIn = () => {
  const manager = SettingsManager.inMemory();

  manager.setEnableAnalytics(true);

  expect(manager.getEnableAnalytics()).toBe(true);
  expect(manager.getTrackingId()).toMatch(/^[0-9a-f-]{36}$/u);
};

const doesNotGenerateATrackingIdentifierOn = () => {
  const manager = SettingsManager.inMemory();

  manager.setEnableAnalytics(false);

  expect(manager.getEnableAnalytics()).toBe(false);
  expect(manager.getTrackingId()).toBeUndefined();
};

const keepsTheTrackingIdentifierWhenTogglingAnalytics = () => {
  const manager = SettingsManager.inMemory();

  manager.setEnableAnalytics(true);
  const trackingId = manager.getTrackingId();
  manager.setEnableAnalytics(false);
  manager.setEnableAnalytics(true);

  expect(manager.getTrackingId()).toBe(trackingId);
};

describe("analytics settings", () => {
  it(
    "defaults to disabled with no tracking identifier",
    defaultsToDisabledWithNoTrackingIdentifier,
  );

  it("generates a tracking identifier on opt-in", generatesATrackingIdentifierOnOptIn);

  it("does not generate a tracking identifier on opt-out", doesNotGenerateATrackingIdentifierOn);

  it(
    "keeps the tracking identifier when toggling analytics",
    keepsTheTrackingIdentifierWhenTogglingAnalytics,
  );
});
