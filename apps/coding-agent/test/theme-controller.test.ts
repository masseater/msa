import { deferredPromise, awaited, runTest } from "@msa/testing";
import type { TerminalColors, TUI } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SettingsManager } from "../src/core/settings-manager.ts";
import { InteractiveThemeController } from "../src/modes/interactive/theme/theme-controller.ts";
import {
  initTheme,
  setTerminalColorScheme,
  setTerminalColors,
  type TerminalTheme,
  theme,
} from "../src/modes/interactive/theme/theme.ts";

const DARK: TerminalColors = {
  foreground: { r: 248, g: 248, b: 242 },
  background: { r: 40, g: 42, b: 54 },
};
const LIGHT: TerminalColors = {
  foreground: { r: 30, g: 30, b: 30 },
  background: { r: 250, g: 250, b: 250 },
};

type ColorQueryOptions = { timeoutMs: number; onLateReply?: (colors: TerminalColors) => void };

function createUi() {
  const queryTerminalColors = vi.fn((_options: ColorQueryOptions): Promise<TerminalColors> =>
    runTest(awaited({})),
  );
  const setTerminalColorSchemeNotifications = vi.fn();
  let terminalColorSchemeListener: ((terminalTheme: TerminalTheme) => void) | undefined;
  const unsubscribeTerminalColorScheme = vi.fn();
  const ui = {
    invalidate: vi.fn(),
    requestRender: vi.fn(),
    setTerminalColorSchemeNotifications,
    onTerminalColorSchemeChange: vi.fn((listener: (terminalTheme: TerminalTheme) => void) => {
      terminalColorSchemeListener = listener;
      return unsubscribeTerminalColorScheme;
    }),
    queryTerminalColors,
  } as unknown as TUI;
  return {
    ui,
    queryTerminalColors,
    setTerminalColorSchemeNotifications,
    unsubscribeTerminalColorScheme,
    emitTerminalColorScheme: (terminalTheme: TerminalTheme) =>
      terminalColorSchemeListener?.(terminalTheme),
  };
}

function createController(
  ui: TUI,
  getSettingsManager: () => SettingsManager,
  initialThemeSetting?: string,
) {
  return new InteractiveThemeController(ui, {
    getSettingsManager,
    showError: vi.fn(),
    onChanged: vi.fn(),
    ...(initialThemeSetting === undefined ? {} : { initialThemeSetting }),
  });
}

const flush = () => Effect.sleep(0);

afterEach(() => {
  setTerminalColors({});
  setTerminalColorScheme(undefined);
  initTheme("dark");
  vi.unstubAllEnvs();
});

describe("InteractiveThemeController", () => {
  it("uses the initial theme without persisting it", () =>
    runTest(
      Effect.gen(function* () {
        const { ui, queryTerminalColors } = createUi();
        const manager = SettingsManager.inMemory({ theme: "dark" });
        const setTheme = vi.spyOn(manager, "setTheme");
        const flushSettings = vi.spyOn(manager, "flush");
        const controller = createController(ui, () => manager, "light");

        expect(theme.name).toBe("light");
        expect(controller.getThemeSelection()).toBe("light");
        controller.applyFromSettings();
        yield* flush();

        expect(queryTerminalColors).toHaveBeenCalledOnce();
        expect(setTheme).not.toHaveBeenCalled();
        expect(flushSettings).not.toHaveBeenCalled();
      }),
    ));

  it("applies the theme immediately and lets startup wait for the colors", () =>
    runTest(
      Effect.gen(function* () {
        const { ui, queryTerminalColors } = createUi();
        const answer = deferredPromise<TerminalColors>();
        queryTerminalColors.mockReturnValue(answer.promise);
        const controller = createController(ui, () => SettingsManager.inMemory());
        controller.applyFromSettings();

        expect(theme.name).toBe("system");
        expect(theme.getFgAnsi("error")).toBe("\x1b[39m");

        answer.resolve(DARK);
        yield* awaited(controller.waitForTerminalColors());
        expect(theme.getFgAnsi("error").startsWith("\x1b[38;")).toBe(true);
      }),
    ));

  it("falls back to palette indices, then applies colors that arrive after the timeout", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { ui, queryTerminalColors } = createUi();
        let lateReply: (colors: TerminalColors) => void = () => {};
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
    ));

  it("re-queries the colors on appearance changes and lets them decide", () =>
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
    ));

  it("uses the reported scheme for the system theme when the terminal reports no colors", () =>
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
    ));

  it("re-renders only when the reported colors change", () =>
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
    ));

  it("disables terminal appearance updates when disposed", () =>
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
    ));

  it("lets an explicit selection replace the initial theme", () =>
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
    ));

  it("reloads theme settings when no initial theme was supplied", () =>
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
    ));
});
