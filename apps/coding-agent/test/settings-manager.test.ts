import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import settingsManagerSupport from "./settings-manager-support.ts";

const { readSettings, removeSettingsDirs, withSettings } = settingsManagerSupport;

const { awaited, runTest, writeJsonFile, writeTextFile } = testing;

afterEach(() => runTest(removeSettingsDirs));

const shouldPreserveEnabledmodelsWhenChangingThinkingLevel = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          defaultModel: "claude-sonnet",
          theme: "dark",
        });

        const manager = openManager();

        const currentSettings = yield* readSettings(settingsPath);
        currentSettings.enabledModels = ["claude-opus-4-5", "gpt-5.2-codex"];
        yield* writeJsonFile(settingsPath, currentSettings);

        manager.models.setDefaultThinkingLevel("high");
        yield* awaited(manager.persistence.flush());

        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.enabledModels).toEqual(["claude-opus-4-5", "gpt-5.2-codex"]);
        expect(savedSettings.defaultThinkingLevel).toBe("high");
        expect(savedSettings.theme).toBe("dark");
        expect(savedSettings.defaultModel).toBe("claude-sonnet");
      }),
    ),
  );

const shouldPreserveCustomSettingsWhenChangingTheme = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { defaultModel: "claude-sonnet" });

        const manager = openManager();

        const currentSettings = yield* readSettings(settingsPath);
        currentSettings.shellPath = "/bin/zsh";
        currentSettings.extensions = ["/path/to/extension.ts"];
        yield* writeJsonFile(settingsPath, currentSettings);

        manager.display.setTheme("light");
        yield* awaited(manager.persistence.flush());

        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.shellPath).toBe("/bin/zsh");
        expect(savedSettings.extensions).toEqual(["/path/to/extension.ts"]);
        expect(savedSettings.theme).toBe("light");
      }),
    ),
  );

const shouldLetInMemoryChangesOverrideFile = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });

        const manager = openManager();

        const currentSettings = yield* readSettings(settingsPath);
        currentSettings.defaultThinkingLevel = "low";
        yield* writeJsonFile(settingsPath, currentSettings);

        manager.models.setDefaultThinkingLevel("high");
        yield* awaited(manager.persistence.flush());

        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.defaultThinkingLevel).toBe("high");
      }),
    ),
  );

const createsOneGlobalDeviceIdAndReuses = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });
        yield* writeJsonFile(projectSettingsPath, { deviceId: "project-device" });
        const first = openManager();

        const deviceId = first.telemetry.getOrCreateDeviceId();
        yield* awaited(first.persistence.flush());

        expect(deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
        expect(first.telemetry.getOrCreateDeviceId()).toBe(deviceId);
        expect(openManager().telemetry.getOrCreateDeviceId()).toBe(deviceId);
        expect(yield* readSettings(settingsPath)).toEqual({ deviceId, theme: "dark" });
      }),
    ),
  );

const shouldKeepLocalOnlyExtensionsInExtensions = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          extensions: ["/local/ext.ts", "./relative/ext.ts"],
        });

        const manager = openManager();

        expect(manager.resources.getPackages()).toEqual([]);
        expect(manager.resources.getExtensionPaths()).toEqual([
          "/local/ext.ts",
          "./relative/ext.ts",
        ]);
      }),
    ),
  );

const shouldHandlePackagesWithFilteringObjects = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          packages: [
            "npm:simple-pkg",
            {
              extensions: ["extensions/oracle.ts"],
              skills: [],
              source: "npm:shitty-extensions",
            },
          ],
        });

        const manager = openManager();

        const packages = manager.resources.getPackages();
        expect(packages).toHaveLength(2);
        expect(packages[0]).toBe("npm:simple-pkg");
        expect(packages[1]).toEqual({
          extensions: ["extensions/oracle.ts"],
          skills: [],
          source: "npm:shitty-extensions",
        });
      }),
    ),
  );

const shouldReloadGlobalSettingsFromDisk = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          extensions: ["/before.ts"],
          theme: "dark",
        });

        const manager = openManager();

        yield* writeJsonFile(settingsPath, {
          defaultModel: "claude-sonnet",
          extensions: ["/after.ts"],
          theme: "light",
        });

        yield* awaited(manager.persistence.reload());

        expect(manager.display.getTheme()).toBe("light");
        expect(manager.resources.getExtensionPaths()).toEqual(["/after.ts"]);
        expect(manager.models.getDefaultModel()).toBe("claude-sonnet");
      }),
    ),
  );

const shouldKeepPreviousSettingsAndReportThe = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });

        const manager = openManager();

        yield* writeTextFile(settingsPath, "{ invalid json");
        yield* awaited(manager.persistence.reload());

        expect(manager.display.getTheme()).toBe("dark");
        expect(manager.drainErrors()).toMatchObject([{ path: settingsPath, scope: "global" }]);
      }),
    ),
  );

const storesSlashSeparatedAutomaticThemeSettingsSeparately = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "light/dark" });

        const manager = openManager();

        expect(manager.display.getTheme()).toBeUndefined();
        expect(manager.display.getThemeSetting()).toBe("light/dark");

        manager.display.setTheme("solarized-light/tokyo-night");
        yield* awaited(manager.persistence.flush());

        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.theme).toBe("solarized-light/tokyo-night");
      }),
    ),
  );

const shouldCollectAndClearLoadErrorsVia = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeTextFile(settingsPath, "{ invalid global json");
        yield* writeTextFile(projectSettingsPath, "{ invalid project json");

        const manager = openManager();
        const errors = manager.drainErrors();

        expect(errors).toHaveLength(2);
        expect(errors).toMatchObject([
          { path: settingsPath, scope: "global" },
          { path: projectSettingsPath, scope: "project" },
        ]);
        expect(manager.drainErrors()).toEqual([]);
      }),
    ),
  );

describe("SettingsManager", () => {
  describe("preserves externally added settings", () => {
    it(
      "should preserve enabledModels when changing thinking level",
      shouldPreserveEnabledmodelsWhenChangingThinkingLevel,
    );

    it(
      "should preserve custom settings when changing theme",
      shouldPreserveCustomSettingsWhenChangingTheme,
    );

    it(
      "should let in-memory changes override file changes for same key",
      shouldLetInMemoryChangesOverrideFile,
    );
  });

  describe("deviceId", () => {
    it(
      "creates one global device ID and reuses it in later processes",
      createsOneGlobalDeviceIdAndReuses,
    );
  });

  describe("packages migration", () => {
    it(
      "should keep local-only extensions in extensions array",
      shouldKeepLocalOnlyExtensionsInExtensions,
    );

    it("should handle packages with filtering objects", shouldHandlePackagesWithFilteringObjects);
  });

  describe("reload", () => {
    it("should reload global settings from disk", shouldReloadGlobalSettingsFromDisk);

    it(
      "should keep previous settings and report the file path when the file is invalid",
      shouldKeepPreviousSettingsAndReportThe,
    );
  });
});

describe("SettingsManager", () => {
  describe("theme setting", () => {
    it(
      "stores slash-separated automatic theme settings separately from fixed theme names",
      storesSlashSeparatedAutomaticThemeSettingsSeparately,
    );
  });

  describe("error tracking", () => {
    it("should collect and clear load errors via drainErrors", shouldCollectAndClearLoadErrorsVia);
  });
});
