import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import SettingsManager from "../src/core/settings-manager.ts";
import settingsManagerSupport from "./settings-manager-support.ts";
const { persistedAfter, readSettings, removeSettingsDirs, settingsRead, withSettings } =
  settingsManagerSupport;

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
        expect((yield* openManager()).session.getCacheWarmingMode()).toBe("streaming");

        yield* writeJsonFile(projectSettingsPath, { cacheWarming: "idle" });
        expect((yield* openManager()).session.getCacheWarmingMode()).toBe("streaming");

        yield* writeJsonFile(settingsPath, { cacheWarming: "idle" });
        expect((yield* openManager()).session.getCacheWarmingMode()).toBe("idle");

        yield* writeJsonFile(settingsPath, { cacheWarming: "bogus" });
        expect((yield* openManager()).session.getCacheWarmingMode()).toBe("streaming");
      }),
    ),
  );

const persistsTheModeGlobally = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = yield* openManager();
        manager.session.setCacheWarmingMode("off");
        yield* awaited(manager.persistence.flush());

        expect((yield* openManager()).session.getCacheWarmingMode()).toBe("off");
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

const validatesAndPersistsFullscreenSettings = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        const manager = yield* openManager();
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
        const reloadedManager = yield* openManager();
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
        const manager = yield* openManager();
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
          expect((yield* openManager()).terminal.getFullscreenWheelScrollLines()).toBe(expected);
        }
      }),
    ),
  );

const persistsRegularTuiMode = () =>
  runTest(
    Effect.gen(function* () {
      const { manager, saved } = yield* persistedAfter(
        (opened) => opened.terminal.setTuiMode("regular"),
        { check: (opened) => expect(opened.terminal.getTuiMode()).toBe("fullscreen") },
      );
      expect(manager.terminal.getTuiMode()).toBe("regular");
      expect(saved.tuiMode).toBe("regular");
    }),
  );

const persistsBinaryOutputPad = () =>
  runTest(
    Effect.gen(function* () {
      const { manager, saved } = yield* persistedAfter(
        (opened) => opened.terminal.setOutputPad(0),
        { check: (opened) => expect(opened.terminal.getOutputPad()).toBe(1) },
      );
      expect(manager.terminal.getOutputPad()).toBe(0);
      expect(saved.outputPad).toBe(0);
    }),
  );

const persistsMermaidRenderingMode = () =>
  runTest(
    Effect.gen(function* () {
      const { manager, saved } = yield* persistedAfter(
        (opened) => opened.display.setMermaidRenderingMode("final"),
        { check: (opened) => expect(opened.display.getMermaidRenderingMode()).toBe("streaming") },
      );
      expect(manager.display.getMermaidRenderingMode()).toBe("final");
      expect(saved.markdown.mermaid).toBe("final");
    }),
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
    it("defaults to fullscreen and persists regular mode", persistsRegularTuiMode);

    settingsRead(
      (manager) => manager.terminal.getTuiMode(),
      [
        [
          "falls back to fullscreen for unsupported values",
          { global: { tuiMode: "other" } },
          "fullscreen",
        ],
        [
          "does not recognize the old uiMode setting",
          { global: { uiMode: "regular" } },
          "fullscreen",
        ],
      ],
    );
  });

  describe("fullscreen", () => {
    it("validates and persists fullscreen settings", validatesAndPersistsFullscreenSettings);

    it("persists fullscreen wheel scroll lines", persistsFullscreenWheelScrollLines);
  });
});

describe("SettingsManager", () => {
  describe("outputPad", () => {
    it("should default to 1 and persist binary values", persistsBinaryOutputPad);

    settingsRead(
      (manager) => manager.terminal.getOutputPad(),
      [
        [
          "should treat unsupported outputPad values as default padding",
          { global: { outputPad: 2 } },
          1,
        ],
      ],
    );
  });

  describe("markdown.mermaid", () => {
    it("defaults to streaming and persists rendering modes", persistsMermaidRenderingMode);

    settingsRead(
      (manager) => manager.display.getMermaidRenderingMode(),
      [
        [
          "falls back to streaming for unsupported values",
          { global: { markdown: { mermaid: "sometimes" } } },
          "streaming",
        ],
      ],
    );
  });
});
