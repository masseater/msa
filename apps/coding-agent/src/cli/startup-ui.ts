import { existsSync } from "fs";

import {
  ProcessTerminal,
  setCapabilityOverrides,
  setKeybindings,
  type TUI,
  TuiMainScreen,
} from "@msa/tui";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import {
  APP_NAME,
  CONFIG_DIR_NAME,
  ENV_AGENT_DIR,
  getAgentDir,
  getSettingsPath,
  PACKAGE_NAME,
} from "../config.ts";
import { awaited, awaiting, performed } from "../core/awaiting.ts";
import { areExperimentalFeaturesEnabled } from "../core/experimental.ts";
import { KeybindingsManager } from "../core/keybindings.ts";
import { DefaultPackageManager, type ResolvedResource } from "../core/package-manager.ts";
import { readEnv } from "../core/platform.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { ExtensionInputComponent } from "../modes/interactive/components/extension-input.ts";
import { ExtensionSelectorComponent } from "../modes/interactive/components/extension-selector.ts";
import {
  FirstTimeSetupComponent,
  type FirstTimeSetupResult,
} from "../modes/interactive/components/first-time-setup.ts";
import { SYSTEM_THEME_NAME } from "../modes/interactive/theme/system-theme.ts";
import { requestTerminalColors } from "../modes/interactive/theme/theme-controller.ts";
import {
  getTerminalTheme,
  initTheme,
  loadThemeFromPath,
  markTerminalColorsPending,
  resolveThemeSetting,
  setRegisteredThemes,
  setTerminalColors,
  setTheme,
  type Theme,
} from "../modes/interactive/theme/theme.ts";
import { callbackPromise } from "../utils/interop.ts";

const OFFICIAL_PACKAGE_NAME = "@msa/coding-agent";
const OFFICIAL_APP_NAME = "msa";
const OFFICIAL_CONFIG_DIR_NAME = ".msa";

interface DistributionMetadata {
  packageName: string;
  appName: string;
  configDirName: string;
}

function isOfficialDistribution({
  packageName,
  appName,
  configDirName,
}: DistributionMetadata): boolean {
  return (
    packageName === OFFICIAL_PACKAGE_NAME &&
    appName === OFFICIAL_APP_NAME &&
    configDirName === OFFICIAL_CONFIG_DIR_NAME
  );
}

function loadThemes(resources: ResolvedResource[]): Theme[] {
  const themes: Theme[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!resource.enabled) continue;
    try {
      const loadedTheme = loadThemeFromPath(resource.path);
      if (loadedTheme.name !== undefined && loadedTheme.name !== "") {
        if (seen.has(loadedTheme.name)) continue;
        seen.add(loadedTheme.name);
      }
      themes.push(loadedTheme);
    } catch {}
  }
  return themes;
}

function loadStartupThemes(settingsManager: SettingsManager): Promise<Theme[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const globalSettingsManager = SettingsManager.inMemory(settingsManager.getGlobalSettings(), {
        projectTrusted: false,
      });
      const packageManager = new DefaultPackageManager({
        cwd: process.cwd(),
        agentDir: getAgentDir(),
        settingsManager: globalSettingsManager,
      });
      const resolvedPaths = yield* awaited(
        packageManager.resolve(() => Effect.runPromise(Effect.succeed("skip"))),
      );
      return loadThemes(resolvedPaths.themes);
    }),
  );
}

export function createStartupTui(settingsManager: SettingsManager): Promise<TUI> {
  return Effect.runPromise(
    awaiting(function* () {
      setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());
      setRegisteredThemes(yield* awaited(loadStartupThemes(settingsManager)));

      markTerminalColorsPending();
      initTheme(
        resolveThemeSetting(settingsManager.getThemeSetting(), getTerminalTheme()) ??
          SYSTEM_THEME_NAME,
      );
      setKeybindings(KeybindingsManager.create());
      const ui: TUI = new TuiMainScreen(
        new ProcessTerminal(),
        settingsManager.getShowHardwareCursor(),
        getAgentDir(),
      );
      ui.setClearOnShrink(settingsManager.getClearOnShrink());
      return ui;
    }),
  );
}

function startStartupTuiImpl(ui: TUI, settingsManager: SettingsManager): void {
  ui.start();
  const themeSetting = settingsManager.getThemeSetting();
  queryStartupTerminalColors(ui, () => {
    setTheme(resolveThemeSetting(themeSetting, getTerminalTheme()) ?? SYSTEM_THEME_NAME);
  });
}

export const startStartupTui: {
  (ui: TUI, settingsManager: SettingsManager): void;
  (settingsManager: SettingsManager): (ui: TUI) => void;
} = dual((args: IArguments) => args.length >= 2, startStartupTuiImpl);

function queryStartupTerminalColors(ui: TUI, onColors: () => void): void {
  void requestTerminalColors(ui, (colors) => {
    setTerminalColors(colors);
    onColors();
    ui.invalidate();
    ui.requestRender();
  });
}

function clearStartupTui(ui: TUI): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      ui.clear();
      ui.requestRender();
      yield* performed(Effect.sleep(25));
    }),
  );
}

export function shouldRunFirstTimeSetup(settingsPath: string = getSettingsPath()): boolean {
  if (
    !isOfficialDistribution({
      packageName: PACKAGE_NAME,
      appName: APP_NAME,
      configDirName: CONFIG_DIR_NAME,
    })
  ) {
    return false;
  }
  if (!areExperimentalFeaturesEnabled()) {
    return false;
  }
  if (readEnv(ENV_AGENT_DIR) !== undefined && readEnv(ENV_AGENT_DIR) !== "") {
    return false;
  }
  return !existsSync(settingsPath);
}

function showStartupSelectorImpl<T>(
  settingsManager: SettingsManager,
  title: string,
  options: Array<{ label: string; value: T }>,
): Promise<T | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const ui = yield* awaited(createStartupTui(settingsManager));
      return yield* awaited(
        callbackPromise((resolve) => {
          let settled = false;
          const finish = (result: T | undefined) =>
            Effect.runPromise(
              awaiting(function* () {
                if (settled) {
                  return;
                }
                settled = true;
                yield* awaited(clearStartupTui(ui));
                ui.stop();
                resolve(result);
              }),
            );

          const selector = new ExtensionSelectorComponent(
            title,
            options.map((option) => option.label),
            (option) => void finish(options.find((entry) => entry.label === option)?.value),
            () => void finish(undefined),
            { tui: ui },
          );
          ui.addChild(selector);
          ui.setFocus(selector);
          startStartupTui(ui, settingsManager);
        }),
      );
    }),
  );
}

export const showStartupSelector: {
  <T>(
    settingsManager: SettingsManager,
    title: string,
    options: Array<{ label: string; value: T }>,
  ): Promise<T | undefined>;
  <T>(
    title: string,
    options: Array<{ label: string; value: T }>,
  ): (settingsManager: SettingsManager) => Promise<T | undefined>;
} = dual((args: IArguments) => args.length >= 3, showStartupSelectorImpl);

export function showFirstTimeSetup(settingsManager: SettingsManager): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const ui = yield* awaited(createStartupTui(settingsManager));
      return yield* awaited(
        callbackPromise((resolve) => {
          let settled = false;
          const finish = (result: FirstTimeSetupResult | undefined) =>
            Effect.runPromise(
              awaiting(function* () {
                if (settled) {
                  return;
                }
                settled = true;
                if (result !== undefined) {
                  settingsManager.setTheme(result.theme);
                  settingsManager.setEnableAnalytics(result.shareAnalytics);
                  yield* awaited(settingsManager.flush());
                }
                yield* awaited(clearStartupTui(ui));
                ui.stop();
                resolve();
              }),
            );

          ui.start();
          let previewTheme = SYSTEM_THEME_NAME;
          setTheme(previewTheme);
          const component = new FirstTimeSetupComponent({
            onThemePreview: (themeName) => {
              previewTheme = themeName;
              setTheme(themeName);
              ui.requestRender();
            },
            onSubmit: (result) => void finish(result),
            onCancel: () => void finish(undefined),
          });
          ui.addChild(component);
          ui.setFocus(component);
          ui.requestRender();

          queryStartupTerminalColors(ui, () => setTheme(previewTheme));
        }),
      );
    }),
  );
}

function showStartupInputImpl(
  settingsManager: SettingsManager,
  title: string,
  placeholder?: string,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const ui = yield* awaited(createStartupTui(settingsManager));
      return yield* awaited(
        callbackPromise((resolve) => {
          let settled = false;
          const finish = (result: string | undefined) =>
            Effect.runPromise(
              awaiting(function* () {
                if (settled) {
                  return;
                }
                settled = true;
                input.dispose();
                yield* awaited(clearStartupTui(ui));
                ui.stop();
                resolve(result);
              }),
            );

          const input = new ExtensionInputComponent(
            title,
            placeholder,
            (value) => void finish(value),
            () => void finish(undefined),
            {
              tui: ui,
            },
          );
          ui.addChild(input);
          ui.setFocus(input);
          startStartupTui(ui, settingsManager);
        }),
      );
    }),
  );
}

export const showStartupInput: {
  (
    settingsManager: SettingsManager,
    title: string,
    placeholder?: string,
  ): Promise<string | undefined>;
  (
    title: string,
    placeholder?: string,
  ): (settingsManager: SettingsManager) => Promise<string | undefined>;
} = dual((args: IArguments) => args.length >= 2, showStartupInputImpl);
