import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import SettingsManager from "../src/core/settings-manager.ts";
import terminalColors from "../src/modes/interactive/theme/terminal-colors.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import themeControllerSupport from "./theme-controller-support.ts";

const { initTheme, theme } = themeModule;
const { setTerminalColorScheme, setTerminalColors } = terminalColors;
const { DARK, createController, createUi, flush } = themeControllerSupport;

const { awaited, deferredPromise, runTest } = testing;

const LIGHT: tuiTypes.TerminalColors = {
  background: { b: 250, g: 250, r: 250 },
  foreground: { b: 30, g: 30, r: 30 },
};

afterEach(() => {
  setTerminalColors({});
  setTerminalColorScheme(undefined);
  initTheme("dark");
  vi.unstubAllEnvs();
});

const usesTheInitialThemeWithoutPersistingIt = () =>
  runTest(
    Effect.gen(function* () {
      const { ui, queryTerminalColors } = createUi();
      const manager = SettingsManager.inMemory({ theme: "dark" });
      const setTheme = vi.spyOn(manager.display, "setTheme");
      const flushSettings = vi.spyOn(manager.persistence, "flush");
      const controller = createController(ui, () => manager, "light");

      expect(theme.name).toBe("light");
      expect(controller.getThemeSelection()).toBe("light");
      controller.applyFromSettings();
      yield* flush();

      expect(queryTerminalColors).toHaveBeenCalledOnce();
      expect(setTheme).not.toHaveBeenCalled();
      expect(flushSettings).not.toHaveBeenCalled();
    }),
  );

const appliesTheThemeImmediatelyAndLetsStartup = () =>
  runTest(
    Effect.gen(function* () {
      const { ui, queryTerminalColors } = createUi();
      const answer = deferredPromise<tuiTypes.TerminalColors>();
      queryTerminalColors.mockReturnValue(answer.promise);
      const controller = createController(ui, () => SettingsManager.inMemory());
      controller.applyFromSettings();

      expect(theme.name).toBe("system");
      expect(theme.getFgAnsi("error")).toBe("\x1b[39m");

      answer.resolve(DARK);
      yield* awaited(controller.waitForTerminalColors());
      expect(theme.getFgAnsi("error").startsWith("\x1b[38;")).toBe(true);
    }),
  );

const fallsBackToPaletteIndicesThenApplies = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const { ui, queryTerminalColors } = createUi();
      let lateReply: (colors: tuiTypes.TerminalColors) => void = () => {};
      queryTerminalColors.mockImplementation((options) =>
        effectRunPromise(
          Effect.gen(function* () {
            lateReply = options.onLateReply!;
            return yield* awaited({});
          }),
        ),
      );
      const controller = createController(ui, () => SettingsManager.inMemory());
      controller.applyFromSettings();
      yield* flush();
      expect(theme.getFgAnsi("error")).toBe("\x1b[38;5;1m");

      lateReply(DARK);
      expect(theme.colors.error.kind).toBe("rgb");
    }),
  );

const reQueriesTheColorsOnAppearanceChanges = () =>
  runTest(
    Effect.gen(function* () {
      const {
        ui,
        queryTerminalColors,
        setTerminalColorSchemeNotifications,
        emitTerminalColorScheme,
      } = createUi();
      queryTerminalColors.mockResolvedValue(LIGHT);
      const controller = createController(ui, () => SettingsManager.inMemory(), "light/dark");
      controller.applyFromSettings();
      expect(setTerminalColorSchemeNotifications).toHaveBeenCalledWith(true);
      yield* flush();
      expect(theme.name).toBe("light");

      queryTerminalColors.mockResolvedValue(DARK);

      emitTerminalColorScheme("light");
      yield* flush();
      expect(theme.name).toBe("dark");
    }),
  );

describe("InteractiveThemeController", () => {
  it("uses the initial theme without persisting it", usesTheInitialThemeWithoutPersistingIt);

  it(
    "applies the theme immediately and lets startup wait for the colors",
    appliesTheThemeImmediatelyAndLetsStartup,
  );

  it(
    "falls back to palette indices, then applies colors that arrive after the timeout",
    fallsBackToPaletteIndicesThenApplies,
  );

  it(
    "re-queries the colors on appearance changes and lets them decide",
    reQueriesTheColorsOnAppearanceChanges,
  );
});
