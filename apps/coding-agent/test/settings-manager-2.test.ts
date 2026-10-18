import { awaited, joinPath, pathExists, removePath, runTest, writeJsonFile } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_HTTP_IDLE_TIMEOUT_MS } from "../src/core/http-dispatcher.ts";
import { type Settings, SettingsManager } from "../src/core/settings-manager.ts";
import { readSettings, removeSettingsDirs, withSettings } from "./settings-manager-support.ts";

afterEach(() => runTest(removeSettingsDirs));

describe("SettingsManager", () => {
  describe("project trust", () => {
    it("should skip project settings when project is not trusted", () =>
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
      ));

    it("should reload project settings after trust changes to true", () =>
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
      ));

    it("should fail project settings writes when project is not trusted", () =>
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
      ));

    it("should read default project trust from global settings only", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { defaultProjectTrust: "always" });
            yield* writeJsonFile(projectSettingsPath, { defaultProjectTrust: "never" });

            const manager = openManager();

            expect(manager.getDefaultProjectTrust()).toBe("always");
          }),
        ),
      ));

    it("should default invalid project trust settings to ask", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { defaultProjectTrust: "sometimes" });

            const manager = openManager();

            expect(manager.getDefaultProjectTrust()).toBe("ask");
          }),
        ),
      ));
  });

  describe("project settings directory creation", () => {
    it("should not create .msa folder when only reading project settings", () =>
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
      ));

    it("should create .msa folder when writing project settings", () =>
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
      ));
  });

  describe("terminal capability overrides", () => {
    it("maps explicit values and omits auto values", () => {
      const getOverrides = (terminal: NonNullable<Settings["terminal"]>) =>
        SettingsManager.inMemory({ terminal }).getTerminalCapabilityOverrides();

      expect(getOverrides({ images: false, trueColor: false, hyperlinks: false })).toEqual({
        images: null,
        trueColor: false,
        hyperlinks: false,
      });
      expect(getOverrides({ images: "kitty", trueColor: true, hyperlinks: true })).toEqual({
        images: "kitty",
        trueColor: true,
        hyperlinks: true,
      });
      expect(getOverrides({ images: "auto", trueColor: "auto", hyperlinks: "auto" })).toEqual({});
    });
  });

  describe("retry settings", () => {
    it("defaults and overrides agent retry delay cap", () => {
      expect(SettingsManager.inMemory().getRetrySettings()).toEqual({
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 2000,
        maxAgentDelayMs: 60000,
      });
      expect(
        SettingsManager.inMemory({
          retry: { enabled: true, maxRetries: 10, baseDelayMs: 500, maxAgentDelayMs: 5000 },
        }).getRetrySettings(),
      ).toEqual({ enabled: true, maxRetries: 10, baseDelayMs: 500, maxAgentDelayMs: 5000 });
    });
  });

  describe("httpIdleTimeoutMs", () => {
    it("should default to 5 minutes", () =>
      runTest(
        withSettings(({ openManager }) =>
          Effect.sync(() => {
            const manager = openManager();
            expect(manager.getHttpIdleTimeoutMs()).toBe(DEFAULT_HTTP_IDLE_TIMEOUT_MS);
          }),
        ),
      ));

    it("should use merged global and project settings", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { httpIdleTimeoutMs: 300000 });
            yield* writeJsonFile(projectSettingsPath, { httpIdleTimeoutMs: 0 });

            const manager = openManager();

            expect(manager.getHttpIdleTimeoutMs()).toBe(0);
          }),
        ),
      ));

    it("should reject invalid timeout values", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { httpIdleTimeoutMs: -1 });
            const manager = openManager();

            expect(() => manager.getHttpIdleTimeoutMs()).toThrow(
              "Invalid httpIdleTimeoutMs setting",
            );
          }),
        ),
      ));
  });
});
