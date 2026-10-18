import { awaited, runTest, writeJsonFile } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SettingsManager } from "../src/core/settings-manager.ts";
import { readSettings, removeSettingsDirs, withSettings } from "./settings-manager-support.ts";

afterEach(() => runTest(removeSettingsDirs));

describe("SettingsManager", () => {
  describe("cacheWarming", () => {
    it("defaults to streaming and ignores project settings", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            expect(openManager().getCacheWarmingMode()).toBe("streaming");

            yield* writeJsonFile(projectSettingsPath, { cacheWarming: "idle" });
            expect(openManager().getCacheWarmingMode()).toBe("streaming");

            yield* writeJsonFile(settingsPath, { cacheWarming: "idle" });
            expect(openManager().getCacheWarmingMode()).toBe("idle");

            yield* writeJsonFile(settingsPath, { cacheWarming: "bogus" });
            expect(openManager().getCacheWarmingMode()).toBe("streaming");
          }),
        ),
      ));

    it("persists the mode globally", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            const manager = openManager();
            manager.setCacheWarmingMode("off");
            yield* awaited(manager.flush());

            expect(openManager().getCacheWarmingMode()).toBe("off");
            expect(yield* readSettings(settingsPath)).toEqual({ cacheWarming: "off" });
          }),
        ),
      ));
  });

  describe("externalEditor", () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

    function setEditorEnv(visual?: string, editor?: string): void {
      vi.stubEnv("VISUAL", visual);
      vi.stubEnv("EDITOR", editor);
    }

    afterEach(() => {
      vi.unstubAllEnvs();
      if (originalPlatform !== undefined) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    });

    it("should resolve editor commands by precedence", () => {
      setEditorEnv("vim", "nano");
      expect(
        SettingsManager.inMemory({ externalEditor: "code --wait" }).getExternalEditorCommand(),
      ).toBe("code --wait");
      expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("vim");

      setEditorEnv(undefined, "emacs");
      expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("emacs");
    });

    it("should fall back to platform defaults", () => {
      setEditorEnv();
      Object.defineProperty(process, "platform", { value: "win32" });
      expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("notepad");

      Object.defineProperty(process, "platform", { value: "darwin" });
      expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("nano");

      Object.defineProperty(process, "platform", { value: "linux" });
      expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("nano");
    });
  });

  describe("TUI mode", () => {
    it("defaults to fullscreen and persists regular mode", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            const manager = openManager();

            expect(manager.getTuiMode()).toBe("fullscreen");

            manager.setTuiMode("regular");
            yield* awaited(manager.flush());

            expect(manager.getTuiMode()).toBe("regular");
            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.tuiMode).toBe("regular");
          }),
        ),
      ));

    it("falls back to fullscreen for unsupported values", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { tuiMode: "other" });

            const manager = openManager();

            expect(manager.getTuiMode()).toBe("fullscreen");
          }),
        ),
      ));

    it("does not recognize the old uiMode setting", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { uiMode: "regular" });

            const manager = openManager();

            expect(manager.getTuiMode()).toBe("fullscreen");
          }),
        ),
      ));
  });

  describe("fullscreen", () => {
    it("validates and persists fullscreen settings", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            const manager = openManager();
            expect(manager.getFullscreenExitOutput()).toBe("transcript");
            expect(manager.getFullscreenScrollbar()).toBe("auto");
            expect(manager.getFullscreenCopyOnSelect()).toBe(true);

            manager.setFullscreenExitOutput("resume-hint");
            manager.setFullscreenScrollbar("hidden");
            manager.setFullscreenCopyOnSelect(false);
            yield* awaited(manager.flush());
            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.fullscreenExitOutput).toBe("resume-hint");
            expect(savedSettings.fullscreenScrollbar).toBe("hidden");
            expect(savedSettings.fullscreenCopyOnSelect).toBe(false);

            yield* writeJsonFile(settingsPath, {
              fullscreenExitOutput: "nothing",
              fullscreenScrollbar: "sometimes",
            });
            const reloadedManager = openManager();
            expect(reloadedManager.getFullscreenExitOutput()).toBe("transcript");
            expect(reloadedManager.getFullscreenScrollbar()).toBe("auto");
            expect(reloadedManager.getFullscreenCopyOnSelect()).toBe(true);
          }),
        ),
      ));

    it("persists fullscreen wheel scroll lines", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            const manager = openManager();
            expect(manager.getFullscreenWheelScrollLines()).toBe("auto");

            manager.setFullscreenWheelScrollLines(3);
            yield* awaited(manager.flush());
            expect((yield* readSettings(settingsPath)).fullscreenWheelScrollLines).toBe(3);

            for (const [value, expected] of [
              [7.9, 7],
              [0, 1],
              [1000, 100],
              ["fast", "auto"],
              [null, "auto"],
            ] as const) {
              yield* writeJsonFile(settingsPath, { fullscreenWheelScrollLines: value });
              expect(openManager().getFullscreenWheelScrollLines()).toBe(expected);
            }
          }),
        ),
      ));
  });

  describe("outputPad", () => {
    it("should default to 1 and persist binary values", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            const manager = openManager();

            expect(manager.getOutputPad()).toBe(1);

            manager.setOutputPad(0);
            yield* awaited(manager.flush());

            expect(manager.getOutputPad()).toBe(0);
            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.outputPad).toBe(0);
          }),
        ),
      ));

    it("should treat unsupported outputPad values as default padding", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { outputPad: 2 });

            const manager = openManager();

            expect(manager.getOutputPad()).toBe(1);
          }),
        ),
      ));
  });

  describe("markdown.mermaid", () => {
    it("defaults to streaming and persists rendering modes", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            const manager = openManager();

            expect(manager.getMermaidRenderingMode()).toBe("streaming");

            manager.setMermaidRenderingMode("final");
            yield* awaited(manager.flush());

            expect(manager.getMermaidRenderingMode()).toBe("final");
            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.markdown.mermaid).toBe("final");
          }),
        ),
      ));

    it("falls back to streaming for unsupported values", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { markdown: { mermaid: "sometimes" } });

            expect(openManager().getMermaidRenderingMode()).toBe("streaming");
          }),
        ),
      ));
  });
});
