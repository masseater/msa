import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import startupUi from "../src/cli/startup-ui.ts";
import config from "../src/config.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { deleteEnv, readEnv, writeEnv } = platform;
const { ENV_AGENT_DIR } = config;
const { shouldRunFirstTimeSetup } = startupUi;
const { joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

const originalMsaExperimental = readEnv("MSA_EXPERIMENTAL");

const originalAgentDir = readEnv(ENV_AGENT_DIR);

let tempDir: string;

let settingsPath: string;

const setupWanted = () => Effect.promise(() => shouldRunFirstTimeSetup(settingsPath));

const returnsTrueWhenExperimentalDefaultAgentDir = () =>
  runTest(
    Effect.gen(function* () {
      expect(yield* setupWanted()).toBe(true);
    }),
  );

const returnsFalseWhenExperimentalFeaturesAreDisabled = () =>
  runTest(
    Effect.gen(function* () {
      deleteEnv("MSA_EXPERIMENTAL");
      expect(yield* setupWanted()).toBe(false);
    }),
  );

const returnsFalseWhenACustomAgentDir = () =>
  runTest(
    Effect.gen(function* () {
      writeEnv(ENV_AGENT_DIR, tempDir);
      expect(yield* setupWanted()).toBe(false);
    }),
  );

const returnsFalseWhenSettingsJsonAlreadyExists = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(settingsPath, "{}");
      expect(yield* setupWanted()).toBe(false);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-first-time-setup-");
      settingsPath = joinPath(tempDir, "settings.json");
      writeEnv("MSA_EXPERIMENTAL", "1");
      writeEnv(ENV_AGENT_DIR, "");
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

  expect(manager.telemetry.getEnableAnalytics()).toBe(false);
  expect(manager.telemetry.getTrackingId()).toBeUndefined();
};

const generatesATrackingIdentifierOnOptIn = () => {
  const manager = SettingsManager.inMemory();

  manager.telemetry.setEnableAnalytics(true);

  expect(manager.telemetry.getEnableAnalytics()).toBe(true);
  expect(manager.telemetry.getTrackingId()).toMatch(/^[0-9a-f-]{36}$/u);
};

const doesNotGenerateATrackingIdentifierOn = () => {
  const manager = SettingsManager.inMemory();

  manager.telemetry.setEnableAnalytics(false);

  expect(manager.telemetry.getEnableAnalytics()).toBe(false);
  expect(manager.telemetry.getTrackingId()).toBeUndefined();
};

const keepsTheTrackingIdentifierWhenTogglingAnalytics = () => {
  const manager = SettingsManager.inMemory();

  manager.telemetry.setEnableAnalytics(true);
  const trackingId = manager.telemetry.getTrackingId();
  manager.telemetry.setEnableAnalytics(false);
  manager.telemetry.setEnableAnalytics(true);

  expect(manager.telemetry.getTrackingId()).toBe(trackingId);
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
