import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import SettingsManager from "../src/core/settings-manager.ts";
import settingsManagerSupport from "./settings-manager-support.ts";
const { readSettings, removeSettingsDirs, withSettings } = settingsManagerSupport;

const { awaited, runTest, writeJsonFile } = testing;

afterEach(() => runTest(removeSettingsDirs));

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

function setEditorEnv(visual?: string, editor?: string): void {
  vi.stubEnv("VISUAL", visual);
  vi.stubEnv("EDITOR", editor);
}

const defaultsToStreamingAndIgnoresProjectSettings = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        expect(openManager().session.getCacheWarmingMode()).toBe("streaming");

        yield* writeJsonFile(projectSettingsPath, { cacheWarming: "idle" });
        expect(openManager().session.getCacheWarmingMode()).toBe("streaming");

        yield* writeJsonFile(settingsPath, { cacheWarming: "idle" });
        expect(openManager().session.getCacheWarmingMode()).toBe("idle");

        yield* writeJsonFile(settingsPath, { cacheWarming: "bogus" });
        expect(openManager().session.getCacheWarmingMode()).toBe("streaming");
      }),
    ),
  );

const persistsTheModeGlobally = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = openManager();
        manager.session.setCacheWarmingMode("off");
        yield* awaited(manager.persistence.flush());

        expect(openManager().session.getCacheWarmingMode()).toBe("off");
        expect(yield* readSettings(settingsPath)).toEqual({ cacheWarming: "off" });
      }),
    ),
  );

const shouldResolveEditorCommandsByPrecedence = () => {
  setEditorEnv("vim", "nano");
  expect(
    SettingsManager.inMemory({ externalEditor: "code --wait" }).terminal.getExternalEditorCommand(),
  ).toBe("code --wait");
  expect(SettingsManager.inMemory().terminal.getExternalEditorCommand()).toBe("vim");

  setEditorEnv(undefined, "emacs");
  expect(SettingsManager.inMemory().terminal.getExternalEditorCommand()).toBe("emacs");
};

const shouldFallBackToPlatformDefaults = () => {
  setEditorEnv();
  Object.defineProperty(process, "platform", { value: "win32" });
  expect(SettingsManager.inMemory().terminal.getExternalEditorCommand()).toBe("notepad");

  Object.defineProperty(process, "platform", { value: "darwin" });
  expect(SettingsManager.inMemory().terminal.getExternalEditorCommand()).toBe("nano");

  Object.defineProperty(process, "platform", { value: "linux" });
  expect(SettingsManager.inMemory().terminal.getExternalEditorCommand()).toBe("nano");
};

const defaultsToFullscreenAndPersistsRegularMode = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = openManager();

        expect(manager.terminal.getTuiMode()).toBe("fullscreen");

        manager.terminal.setTuiMode("regular");
        yield* awaited(manager.persistence.flush());

        expect(manager.terminal.getTuiMode()).toBe("regular");
        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.tuiMode).toBe("regular");
      }),
    ),
  );

const fallsBackToFullscreenForUnsupportedValues = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { tuiMode: "other" });

        const manager = openManager();

        expect(manager.terminal.getTuiMode()).toBe("fullscreen");
      }),
    ),
  );

const doesNotRecognizeTheOldUimodeSetting = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { uiMode: "regular" });

        const manager = openManager();

        expect(manager.terminal.getTuiMode()).toBe("fullscreen");
      }),
    ),
  );

const validatesAndPersistsFullscreenSettings = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = openManager();
        expect(manager.terminal.getFullscreenExitOutput()).toBe("transcript");
        expect(manager.terminal.getFullscreenScrollbar()).toBe("auto");
        expect(manager.terminal.getFullscreenCopyOnSelect()).toBe(true);

        manager.terminal.setFullscreenExitOutput("resume-hint");
        manager.terminal.setFullscreenScrollbar("hidden");
        manager.terminal.setFullscreenCopyOnSelect(false);
        yield* awaited(manager.persistence.flush());
        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.fullscreenExitOutput).toBe("resume-hint");
        expect(savedSettings.fullscreenScrollbar).toBe("hidden");
        expect(savedSettings.fullscreenCopyOnSelect).toBe(false);

        yield* writeJsonFile(settingsPath, {
          fullscreenExitOutput: "nothing",
          fullscreenScrollbar: "sometimes",
        });
        const reloadedManager = openManager();
        expect(reloadedManager.terminal.getFullscreenExitOutput()).toBe("transcript");
        expect(reloadedManager.terminal.getFullscreenScrollbar()).toBe("auto");
        expect(reloadedManager.terminal.getFullscreenCopyOnSelect()).toBe(true);
      }),
    ),
  );

const persistsFullscreenWheelScrollLines = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = openManager();
        expect(manager.terminal.getFullscreenWheelScrollLines()).toBe("auto");

        manager.terminal.setFullscreenWheelScrollLines(3);
        yield* awaited(manager.persistence.flush());
        expect((yield* readSettings(settingsPath)).fullscreenWheelScrollLines).toBe(3);

        for (const [value, expected] of [
          [7.9, 7],
          [0, 1],
          [1000, 100],
          ["fast", "auto"],
          [null, "auto"],
        ] as const) {
          yield* writeJsonFile(settingsPath, { fullscreenWheelScrollLines: value });
          expect(openManager().terminal.getFullscreenWheelScrollLines()).toBe(expected);
        }
      }),
    ),
  );

const shouldDefaultTo1AndPersistBinary = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = openManager();

        expect(manager.terminal.getOutputPad()).toBe(1);

        manager.terminal.setOutputPad(0);
        yield* awaited(manager.persistence.flush());

        expect(manager.terminal.getOutputPad()).toBe(0);
        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.outputPad).toBe(0);
      }),
    ),
  );

const shouldTreatUnsupportedOutputpadValuesAsDefault = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { outputPad: 2 });

        const manager = openManager();

        expect(manager.terminal.getOutputPad()).toBe(1);
      }),
    ),
  );

const defaultsToStreamingAndPersistsRenderingModes = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = openManager();

        expect(manager.display.getMermaidRenderingMode()).toBe("streaming");

        manager.display.setMermaidRenderingMode("final");
        yield* awaited(manager.persistence.flush());

        expect(manager.display.getMermaidRenderingMode()).toBe("final");
        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.markdown.mermaid).toBe("final");
      }),
    ),
  );

const fallsBackToStreamingForUnsupportedValues = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { markdown: { mermaid: "sometimes" } });

        expect(openManager().display.getMermaidRenderingMode()).toBe("streaming");
      }),
    ),
  );

const afterEachHook = () => {
  vi.unstubAllEnvs();
  if (originalPlatform !== undefined) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
};

describe("SettingsManager", () => {
  describe("cacheWarming", () => {
    it(
      "defaults to streaming and ignores project settings",
      defaultsToStreamingAndIgnoresProjectSettings,
    );

    it("persists the mode globally", persistsTheModeGlobally);
  });

  describe("externalEditor", () => {
    afterEach(afterEachHook);

    it("should resolve editor commands by precedence", shouldResolveEditorCommandsByPrecedence);

    it("should fall back to platform defaults", shouldFallBackToPlatformDefaults);
  });

  describe("TUI mode", () => {
    it(
      "defaults to fullscreen and persists regular mode",
      defaultsToFullscreenAndPersistsRegularMode,
    );

    it(
      "falls back to fullscreen for unsupported values",
      fallsBackToFullscreenForUnsupportedValues,
    );

    it("does not recognize the old uiMode setting", doesNotRecognizeTheOldUimodeSetting);
  });

  describe("fullscreen", () => {
    it("validates and persists fullscreen settings", validatesAndPersistsFullscreenSettings);

    it("persists fullscreen wheel scroll lines", persistsFullscreenWheelScrollLines);
  });
});

describe("SettingsManager", () => {
  describe("outputPad", () => {
    it("should default to 1 and persist binary values", shouldDefaultTo1AndPersistBinary);

    it(
      "should treat unsupported outputPad values as default padding",
      shouldTreatUnsupportedOutputpadValuesAsDefault,
    );
  });

  describe("markdown.mermaid", () => {
    it(
      "defaults to streaming and persists rendering modes",
      defaultsToStreamingAndPersistsRenderingModes,
    );

    it("falls back to streaming for unsupported values", fallsBackToStreamingForUnsupportedValues);
  });
});
