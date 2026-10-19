import { awaited, runTest, writeJsonFile, writeTextFile } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { readSettings, removeSettingsDirs, withSettings } from "./settings-manager-support.ts";

afterEach(() => runTest(removeSettingsDirs));

describe("SettingsManager", () => {
  describe("preserves externally added settings", () => {
    it("should preserve enabledModels when changing thinking level", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              theme: "dark",
              defaultModel: "claude-sonnet",
            });

            const manager = openManager();

            const currentSettings = yield* readSettings(settingsPath);
            currentSettings.enabledModels = ["claude-opus-4-5", "gpt-5.2-codex"];
            yield* writeJsonFile(settingsPath, currentSettings);

            manager.setDefaultThinkingLevel("high");
            yield* awaited(manager.flush());

            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.enabledModels).toEqual(["claude-opus-4-5", "gpt-5.2-codex"]);
            expect(savedSettings.defaultThinkingLevel).toBe("high");
            expect(savedSettings.theme).toBe("dark");
            expect(savedSettings.defaultModel).toBe("claude-sonnet");
          }),
        ),
      ));

    it("should preserve custom settings when changing theme", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { defaultModel: "claude-sonnet" });

            const manager = openManager();

            const currentSettings = yield* readSettings(settingsPath);
            currentSettings.shellPath = "/bin/zsh";
            currentSettings.extensions = ["/path/to/extension.ts"];
            yield* writeJsonFile(settingsPath, currentSettings);

            manager.setTheme("light");
            yield* awaited(manager.flush());

            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.shellPath).toBe("/bin/zsh");
            expect(savedSettings.extensions).toEqual(["/path/to/extension.ts"]);
            expect(savedSettings.theme).toBe("light");
          }),
        ),
      ));

    it("should let in-memory changes override file changes for same key", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { theme: "dark" });

            const manager = openManager();

            const currentSettings = yield* readSettings(settingsPath);
            currentSettings.defaultThinkingLevel = "low";
            yield* writeJsonFile(settingsPath, currentSettings);

            manager.setDefaultThinkingLevel("high");
            yield* awaited(manager.flush());

            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.defaultThinkingLevel).toBe("high");
          }),
        ),
      ));
  });

  describe("deviceId", () => {
    it("creates one global device ID and reuses it in later processes", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { theme: "dark" });
            yield* writeJsonFile(projectSettingsPath, { deviceId: "project-device" });
            const first = openManager();

            const deviceId = first.getOrCreateDeviceId();
            yield* awaited(first.flush());

            expect(deviceId).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
            );
            expect(first.getOrCreateDeviceId()).toBe(deviceId);
            expect(openManager().getOrCreateDeviceId()).toBe(deviceId);
            expect(yield* readSettings(settingsPath)).toEqual({ theme: "dark", deviceId });
          }),
        ),
      ));
  });

  describe("packages migration", () => {
    it("should keep local-only extensions in extensions array", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              extensions: ["/local/ext.ts", "./relative/ext.ts"],
            });

            const manager = openManager();

            expect(manager.getPackages()).toEqual([]);
            expect(manager.getExtensionPaths()).toEqual(["/local/ext.ts", "./relative/ext.ts"]);
          }),
        ),
      ));

    it("should handle packages with filtering objects", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              packages: [
                "npm:simple-pkg",
                {
                  source: "npm:shitty-extensions",
                  extensions: ["extensions/oracle.ts"],
                  skills: [],
                },
              ],
            });

            const manager = openManager();

            const packages = manager.getPackages();
            expect(packages).toHaveLength(2);
            expect(packages[0]).toBe("npm:simple-pkg");
            expect(packages[1]).toEqual({
              source: "npm:shitty-extensions",
              extensions: ["extensions/oracle.ts"],
              skills: [],
            });
          }),
        ),
      ));
  });

  describe("reload", () => {
    it("should reload global settings from disk", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              theme: "dark",
              extensions: ["/before.ts"],
            });

            const manager = openManager();

            yield* writeJsonFile(settingsPath, {
              theme: "light",
              extensions: ["/after.ts"],
              defaultModel: "claude-sonnet",
            });

            yield* awaited(manager.reload());

            expect(manager.getTheme()).toBe("light");
            expect(manager.getExtensionPaths()).toEqual(["/after.ts"]);
            expect(manager.getDefaultModel()).toBe("claude-sonnet");
          }),
        ),
      ));

    it("should keep previous settings and report the file path when the file is invalid", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { theme: "dark" });

            const manager = openManager();

            yield* writeTextFile(settingsPath, "{ invalid json");
            yield* awaited(manager.reload());

            expect(manager.getTheme()).toBe("dark");
            expect(manager.drainErrors()).toMatchObject([{ scope: "global", path: settingsPath }]);
          }),
        ),
      ));
  });

  describe("theme setting", () => {
    it("stores slash-separated automatic theme settings separately from fixed theme names", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { theme: "light/dark" });

            const manager = openManager();

            expect(manager.getTheme()).toBeUndefined();
            expect(manager.getThemeSetting()).toBe("light/dark");

            manager.setTheme("solarized-light/tokyo-night");
            yield* awaited(manager.flush());

            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.theme).toBe("solarized-light/tokyo-night");
          }),
        ),
      ));
  });

  describe("error tracking", () => {
    it("should collect and clear load errors via drainErrors", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeTextFile(settingsPath, "{ invalid global json");
            yield* writeTextFile(projectSettingsPath, "{ invalid project json");

            const manager = openManager();
            const errors = manager.drainErrors();

            expect(errors).toHaveLength(2);
            expect(errors).toMatchObject([
              { scope: "global", path: settingsPath },
              { scope: "project", path: projectSettingsPath },
            ]);
            expect(manager.drainErrors()).toEqual([]);
          }),
        ),
      ));
  });
});
