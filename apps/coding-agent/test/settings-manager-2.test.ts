import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_HTTP_IDLE_TIMEOUT_MS } from "../src/core/http-dispatcher.ts";
import { type Settings, SettingsManager } from "../src/core/settings-manager.ts";
import settingsManagerSupport from "./settings-manager-support.ts";

const { readSettings, removeSettingsDirs, withSettings } = settingsManagerSupport;

const { awaited, joinPath, pathExists, removePath, runTest, writeJsonFile } = testing;

afterEach(() => runTest(removeSettingsDirs));

const shouldSkipProjectSettingsWhenProjectIs = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "global" });
        yield* writeJsonFile(projectSettingsPath, { theme: "project" });

        const manager = openManager({ projectTrusted: false });

        expect(manager.isProjectTrusted()).toBe(false);
        expect(manager.getTheme()).toBe("global");
        expect(manager.getProjectSettings()).toEqual({});
      }),
    ),
  );

const shouldReloadProjectSettingsAfterTrustChanges = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "global" });
        yield* writeJsonFile(projectSettingsPath, { theme: "project" });
        const manager = openManager({ projectTrusted: false });

        manager.setProjectTrusted(true);

        expect(manager.isProjectTrusted()).toBe(true);
        expect(manager.getTheme()).toBe("project");
      }),
    ),
  );

const shouldFailProjectSettingsWritesWhenProject = () =>
  runTest(
    withSettings(({ projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(projectSettingsPath, { packages: ["npm:existing"] });
        const manager = openManager({ projectTrusted: false });

        expect(() => manager.setProjectPackages(["npm:new"])).toThrow(
          "Project is not trusted; refusing to write project settings",
        );
        yield* awaited(manager.flush());

        expect(manager.getProjectSettings()).toEqual({});
        expect(yield* readSettings(projectSettingsPath)).toEqual({
          packages: ["npm:existing"],
        });
      }),
    ),
  );

const shouldReadDefaultProjectTrustFromGlobal = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { defaultProjectTrust: "always" });
        yield* writeJsonFile(projectSettingsPath, { defaultProjectTrust: "never" });

        const manager = openManager();

        expect(manager.getDefaultProjectTrust()).toBe("always");
      }),
    ),
  );

const shouldDefaultInvalidProjectTrustSettingsTo = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { defaultProjectTrust: "sometimes" });

        const manager = openManager();

        expect(manager.getDefaultProjectTrust()).toBe("ask");
      }),
    ),
  );

const shouldNotCreateMsaFolderWhenOnly = () =>
  runTest(
    withSettings(({ projectDir, settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });

        yield* removePath(joinPath(projectDir, ".msa"));

        const manager = openManager();

        expect(yield* pathExists(joinPath(projectDir, ".msa"))).toBe(false);

        expect(manager.getTheme()).toBe("dark");
      }),
    ),
  );

const shouldCreateMsaFolderWhenWritingProject = () =>
  runTest(
    withSettings(({ projectDir, settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });

        yield* removePath(joinPath(projectDir, ".msa"));

        const manager = openManager();

        expect(yield* pathExists(joinPath(projectDir, ".msa"))).toBe(false);

        manager.setProjectPackages([{ source: "npm:test-pkg" }]);
        yield* awaited(manager.flush());

        expect(yield* pathExists(joinPath(projectDir, ".msa"))).toBe(true);

        expect(yield* pathExists(joinPath(projectDir, ".msa", "settings.json"))).toBe(true);
      }),
    ),
  );

const mapsExplicitValuesAndOmitsAutoValues = () => {
  const getOverrides = (terminal: NonNullable<Settings["terminal"]>) =>
    SettingsManager.inMemory({ terminal }).getTerminalCapabilityOverrides();

  expect(getOverrides({ hyperlinks: false, images: false, trueColor: false })).toEqual({
    hyperlinks: false,
    images: null,
    trueColor: false,
  });
  expect(getOverrides({ hyperlinks: true, images: "kitty", trueColor: true })).toEqual({
    hyperlinks: true,
    images: "kitty",
    trueColor: true,
  });
  expect(getOverrides({ hyperlinks: "auto", images: "auto", trueColor: "auto" })).toEqual({});
};

const defaultsAndOverridesAgentRetryDelayCap = () => {
  expect(SettingsManager.inMemory().getRetrySettings()).toEqual({
    baseDelayMs: 2000,
    enabled: true,
    maxAgentDelayMs: 60000,
    maxRetries: 3,
  });
  expect(
    SettingsManager.inMemory({
      retry: { baseDelayMs: 500, enabled: true, maxAgentDelayMs: 5000, maxRetries: 10 },
    }).getRetrySettings(),
  ).toEqual({ baseDelayMs: 500, enabled: true, maxAgentDelayMs: 5000, maxRetries: 10 });
};

const shouldDefaultTo5Minutes = () =>
  runTest(
    withSettings(({ openManager }) =>
      Effect.sync(() => {
        const manager = openManager();
        expect(manager.getHttpIdleTimeoutMs()).toBe(DEFAULT_HTTP_IDLE_TIMEOUT_MS);
      }),
    ),
  );

const shouldUseMergedGlobalAndProjectSettings = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { httpIdleTimeoutMs: 300000 });
        yield* writeJsonFile(projectSettingsPath, { httpIdleTimeoutMs: 0 });

        const manager = openManager();

        expect(manager.getHttpIdleTimeoutMs()).toBe(0);
      }),
    ),
  );

const shouldRejectInvalidTimeoutValues = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { httpIdleTimeoutMs: -1 });
        const manager = openManager();

        expect(() => manager.getHttpIdleTimeoutMs()).toThrow("Invalid httpIdleTimeoutMs setting");
      }),
    ),
  );

describe("SettingsManager", () => {
  describe("project trust", () => {
    it(
      "should skip project settings when project is not trusted",
      shouldSkipProjectSettingsWhenProjectIs,
    );

    it(
      "should reload project settings after trust changes to true",
      shouldReloadProjectSettingsAfterTrustChanges,
    );

    it(
      "should fail project settings writes when project is not trusted",
      shouldFailProjectSettingsWritesWhenProject,
    );

    it(
      "should read default project trust from global settings only",
      shouldReadDefaultProjectTrustFromGlobal,
    );

    it(
      "should default invalid project trust settings to ask",
      shouldDefaultInvalidProjectTrustSettingsTo,
    );
  });

  describe("project settings directory creation", () => {
    it(
      "should not create .msa folder when only reading project settings",
      shouldNotCreateMsaFolderWhenOnly,
    );

    it(
      "should create .msa folder when writing project settings",
      shouldCreateMsaFolderWhenWritingProject,
    );
  });
});

describe("SettingsManager", () => {
  describe("terminal capability overrides", () => {
    it("maps explicit values and omits auto values", mapsExplicitValuesAndOmitsAutoValues);
  });

  describe("retry settings", () => {
    it("defaults and overrides agent retry delay cap", defaultsAndOverridesAgentRetryDelayCap);
  });

  describe("httpIdleTimeoutMs", () => {
    it("should default to 5 minutes", shouldDefaultTo5Minutes);

    it("should use merged global and project settings", shouldUseMergedGlobalAndProjectSettings);

    it("should reject invalid timeout values", shouldRejectInvalidTimeoutValues);
  });
});
