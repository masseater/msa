import testing from "@msa/testing";
import type { TUI, TerminalColors } from "@msa/tui";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import { SettingsManager } from "../src/core/settings-manager.ts";
import { InteractiveThemeController } from "../src/modes/interactive/theme/theme-controller.ts";
import { type TerminalTheme } from "../src/modes/interactive/theme/theme.ts";
import type themeControllerSupportTypes from "./theme-controller-support.types.ts";

const { awaited, runTest } = testing;

const DARK: TerminalColors = {
  background: { b: 54, g: 42, r: 40 },
  foreground: { b: 242, g: 248, r: 248 },
};

function createUi() {
  const queryTerminalColors = vi.fn(
    (_options: themeControllerSupportTypes.ColorQueryOptions): Promise<TerminalColors> =>
      runTest(awaited({})),
  );
  const setTerminalColorSchemeNotifications = vi.fn<(enabled: boolean) => void>();
  let terminalColorSchemeListener: ((terminalTheme: TerminalTheme) => void) | undefined;
  const unsubscribeTerminalColorScheme = vi.fn<() => void>();
  const ui = {
    invalidate: vi.fn(),
    onTerminalColorSchemeChange: vi.fn((listener: (terminalTheme: TerminalTheme) => void) => {
      terminalColorSchemeListener = listener;
      return unsubscribeTerminalColorScheme;
    }),
    queryTerminalColors,
    requestRender: vi.fn(),
    setTerminalColorSchemeNotifications,
  } as unknown as TUI;
  return {
    emitTerminalColorScheme: (terminalTheme: TerminalTheme) =>
      terminalColorSchemeListener?.(terminalTheme),
    queryTerminalColors,
    setTerminalColorSchemeNotifications,
    ui,
    unsubscribeTerminalColorScheme,
  };
}

function createController(
  ui: TUI,
  getSettingsManager: () => SettingsManager,
  initialThemeSetting?: string,
) {
  return new InteractiveThemeController(ui, {
    getSettingsManager,
    onChanged: vi.fn(),
    showError: vi.fn(),
    ...(initialThemeSetting === undefined ? {} : { initialThemeSetting }),
  });
}

const flush = () => Effect.sleep(0);

const themeControllerSupport = {
  DARK,
  createController,
  createUi,
  flush,
};

export default themeControllerSupport;
