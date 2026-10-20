import testing from "@msa/testing";
import type { TerminalColors } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SettingsManager } from "../src/core/settings-manager.ts";
import {
  initTheme,
  setTerminalColorScheme,
  setTerminalColors,
  theme,
} from "../src/modes/interactive/theme/theme.ts";
import themeControllerSupport from "./theme-controller-support.ts";

const { DARK, createController, createUi, flush } = themeControllerSupport;

const { awaited, runTest } = testing;

afterEach(() => {
  setTerminalColors({});
  setTerminalColorScheme(undefined);
  initTheme("dark");
  vi.unstubAllEnvs();
});

const usesTheReportedSchemeForTheSystem = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("COLORFGBG", "");
      const { ui, emitTerminalColorScheme } = createUi();
      const controller = createController(ui, () => SettingsManager.inMemory());
      controller.applyFromSettings();
      yield* flush();
      expect(theme.appearance).toBe("dark");

      emitTerminalColorScheme("light");
      expect(theme.appearance).toBe("light");
      expect(controller.getTerminalTheme()).toBe("light");
    }),
  );

const reRendersOnlyWhenTheReportedColors = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const { ui, queryTerminalColors } = createUi();
      const controller = createController(ui, () => SettingsManager.inMemory({ theme: "dark" }));
      const query = (colors: TerminalColors) =>
        effectRunPromise(
          Effect.gen(function* () {
            queryTerminalColors.mockResolvedValue(colors);
            controller.applyFromSettings();
            yield* flush();
          }),
        );

      yield* awaited(query(DARK));

      yield* awaited(query({}));
      yield* awaited(query(structuredClone(DARK)));
      expect(ui.requestRender).toHaveBeenCalledOnce();
    }),
  );

const disablesTerminalAppearanceUpdatesWhenDisposed = () =>
  runTest(
    Effect.gen(function* () {
      const { ui, setTerminalColorSchemeNotifications, unsubscribeTerminalColorScheme } =
        createUi();
      const controller = createController(ui, () =>
        SettingsManager.inMemory({ theme: "light/dark" }),
      );
      controller.applyFromSettings();
      yield* flush();

      controller.dispose();

      expect(setTerminalColorSchemeNotifications).toHaveBeenLastCalledWith(false);
      expect(unsubscribeTerminalColorScheme).toHaveBeenCalledOnce();
    }),
  );

const letsAnExplicitSelectionReplaceTheInitial = () =>
  runTest(
    Effect.gen(function* () {
      const { ui } = createUi();
      const firstManager = SettingsManager.inMemory({ theme: "dark" });
      const secondManager = SettingsManager.inMemory({ theme: "light" });
      let manager = firstManager;
      const controller = createController(ui, () => manager, "light");
      controller.applyFromSettings();

      expect(controller.setThemeName("dark")).toEqual({ success: true });
      manager = secondManager;
      controller.applyFromSettings();
      yield* flush();

      expect(controller.getThemeSelection()).toBe("dark");
      expect(theme.name).toBe("dark");
    }),
  );

const reloadsThemeSettingsWhenNoInitialTheme = () =>
  runTest(
    Effect.sync(() => {
      const { ui } = createUi();
      const firstManager = SettingsManager.inMemory({ theme: "dark" });
      const secondManager = SettingsManager.inMemory({ theme: "light" });
      let manager = firstManager;
      const controller = createController(ui, () => manager);
      controller.applyFromSettings();

      firstManager.applyOverrides({ theme: "light" });
      controller.applyFromSettings();
      expect(theme.name).toBe("light");

      secondManager.applyOverrides({ theme: "dark" });
      manager = secondManager;
      controller.applyFromSettings();
      expect(theme.name).toBe("dark");
    }),
  );

describe("InteractiveThemeController", () => {
  it(
    "uses the reported scheme for the system theme when the terminal reports no colors",
    usesTheReportedSchemeForTheSystem,
  );

  it("re-renders only when the reported colors change", reRendersOnlyWhenTheReportedColors);

  it(
    "disables terminal appearance updates when disposed",
    disablesTerminalAppearanceUpdatesWhenDisposed,
  );

  it(
    "lets an explicit selection replace the initial theme",
    letsAnExplicitSelectionReplaceTheInitial,
  );
});

describe("InteractiveThemeController", () => {
  it(
    "reloads theme settings when no initial theme was supplied",
    reloadsThemeSettingsWhenNoInitialTheme,
  );
});
