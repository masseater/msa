import type tuiTypes from "@msa/tui/index.types";

import text from "../utils/text.ts";
import InMemorySettingsStorage from "./in-memory-settings-storage.ts";
import settingsManagerHelpers from "./settings-manager-helpers.ts";
import SettingsManagerLayer2 from "./settings-manager-layer-2.ts";
import SettingsManager from "./settings-manager.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { stripBom } = text;
const { deepMergeSettings } = settingsManagerHelpers;

export default abstract class SettingsManagerLayer3 extends SettingsManagerLayer2 {
  static inMemory(
    settings: Partial<settingsSchemaTypes.Settings> = {},
    options: settingsManagerTypes.SettingsManagerCreateOptions = {},
  ): SettingsManager {
    const storage = new InMemorySettingsStorage();
    const initialSettings = SettingsManager.migrateSettings(
      structuredClone(settings) as Record<string, unknown>,
    );
    storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
    return SettingsManager.fromStorage(storage, options);
  }

  static loadFromStorage(
    storage: settingsManagerTypes.SettingsStorage,
    scope: settingsManagerTypes.SettingsScope,
    projectTrusted = true,
  ): settingsSchemaTypes.Settings {
    if (scope === "project" && !projectTrusted) {
      return {};
    }

    let content: string | undefined;
    storage.withLock(scope, (current) => {
      content = current;
      return undefined;
    });

    if (content === undefined || content === "") {
      return {};
    }
    const settings = JSON.parse(stripBom(content));
    return SettingsManager.migrateSettings(settings);
  }

  static tryLoadFromStorage(
    storage: settingsManagerTypes.SettingsStorage,
    scope: settingsManagerTypes.SettingsScope,
    projectTrusted = true,
  ): { settings: settingsSchemaTypes.Settings; error: Error | null } {
    try {
      return {
        error: null,
        settings: SettingsManager.loadFromStorage(storage, scope, projectTrusted),
      };
    } catch (error) {
      return { error: error as Error, settings: {} };
    }
  }

  protected setGlobalSetting<K extends keyof settingsSchemaTypes.Settings>(
    field: K,
    value: settingsSchemaTypes.Settings[K],
  ): void {
    this.globalSettings[field] = value;
    this.markModified(field);
    this.save();
  }

  protected enqueueWrite(scope: settingsManagerTypes.SettingsScope, task: () => void): void {
    this.writeQueue = this.writeQueue
      .then(() => {
        if (scope === "project") {
          this.assertProjectTrustedForWrite();
        }
        task();
        this.clearModifiedScope(scope);
        return undefined;
      })
      .catch((error) => {
        this.recordError(scope, error);
      });
  }

  protected persistScopedSettings(
    scope: settingsManagerTypes.SettingsScope,
    snapshotSettings: settingsSchemaTypes.Settings,
    modifiedFields: Set<keyof settingsSchemaTypes.Settings>,
    modifiedNestedFields: Map<keyof settingsSchemaTypes.Settings, Set<string>>,
  ): void {
    this.storage.withLock(scope, (current) => {
      const currentFileSettings =
        current !== undefined && current !== ""
          ? SettingsManager.migrateSettings(
              JSON.parse(stripBom(current)) as Record<string, unknown>,
            )
          : {};
      const mergedSettings: settingsSchemaTypes.Settings = { ...currentFileSettings };
      for (const field of modifiedFields) {
        const value = snapshotSettings[field];
        if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
          const nestedModified = modifiedNestedFields.get(field)!;
          const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
          const inMemoryNested = value as Record<string, unknown>;
          const mergedNested = { ...baseNested };
          for (const nestedKey of nestedModified) {
            mergedNested[nestedKey] = inMemoryNested[nestedKey];
          }
          (mergedSettings as Record<string, unknown>)[field] = mergedNested;
        } else {
          (mergedSettings as Record<string, unknown>)[field] = value;
        }
      }

      return JSON.stringify(mergedSettings, null, 2);
    });
  }

  protected save(): void {
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

    if (this.globalSettingsLoadError !== null) {
      return;
    }

    const snapshotGlobalSettings = structuredClone(this.globalSettings);
    const modifiedFields = new Set(this.modifiedFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);

    this.enqueueWrite("global", () => {
      this.persistScopedSettings(
        "global",
        snapshotGlobalSettings,
        modifiedFields,
        modifiedNestedFields,
      );
    });
  }

  setLastChangelogVersion(version: string): void {
    this.setGlobalSetting("lastChangelogVersion", version);
  }

  setDefaultProvider(provider: string): void {
    this.setGlobalSetting("defaultProvider", provider);
  }

  setDefaultModel(modelId: string): void {
    this.setGlobalSetting("defaultModel", modelId);
  }

  setDefaultModelAndProvider(provider: string, modelId: string): void {
    this.globalSettings.defaultProvider = provider;
    this.globalSettings.defaultModel = modelId;
    this.markModified("defaultProvider");
    this.markModified("defaultModel");
    this.save();
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.setGlobalSetting("steeringMode", mode);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.setGlobalSetting("followUpMode", mode);
  }

  setTheme(theme: string): void {
    this.setGlobalSetting("theme", theme);
  }

  setTransport(transport: settingsSchemaTypes.TransportSetting): void {
    this.setGlobalSetting("transport", transport);
  }

  setCacheWarmingMode(mode: settingsSchemaTypes.CacheWarmingMode): void {
    this.setGlobalSetting("cacheWarming", mode);
  }

  setHideThinkingBlock(hide: boolean): void {
    this.setGlobalSetting("hideThinkingBlock", hide);
  }

  setShowCacheMissNotices(show: boolean): void {
    this.setGlobalSetting("showCacheMissNotices", show);
  }

  setShellPath(path: string | undefined): void {
    this.setGlobalSetting("shellPath", path);
  }

  setQuietStartup(quiet: settingsSchemaTypes.QuietStartup): void {
    this.setGlobalSetting("quietStartup", quiet);
  }

  setDefaultProjectTrust(defaultProjectTrust: settingsSchemaTypes.DefaultProjectTrust): void {
    this.setGlobalSetting("defaultProjectTrust", defaultProjectTrust);
  }

  setShellCommandPrefix(prefix: string | undefined): void {
    this.setGlobalSetting("shellCommandPrefix", prefix);
  }

  setNpmCommand(command: string[] | undefined): void {
    this.setGlobalSetting("npmCommand", command === undefined ? undefined : [...command]);
  }

  setCollapseChangelog(collapse: boolean): void {
    this.setGlobalSetting("collapseChangelog", collapse);
  }

  setEnableInstallTelemetry(enabled: boolean): void {
    this.setGlobalSetting("enableInstallTelemetry", enabled);
  }

  setPackages(packages: settingsSchemaTypes.PackageSource[]): void {
    this.setGlobalSetting("packages", packages);
  }

  setExtensionPaths(paths: string[]): void {
    this.setGlobalSetting("extensions", paths);
  }

  setSkillPaths(paths: string[]): void {
    this.setGlobalSetting("skills", paths);
  }

  setPromptTemplatePaths(paths: string[]): void {
    this.setGlobalSetting("prompts", paths);
  }

  setThemePaths(paths: string[]): void {
    this.setGlobalSetting("themes", paths);
  }

  setEnableSkillCommands(enabled: boolean): void {
    this.setGlobalSetting("enableSkillCommands", enabled);
  }

  getTerminalCapabilityOverrides(): Partial<tuiTypes.TerminalCapabilities> {
    const terminal = this.settings.terminal;
    const images = terminal?.images;
    return {
      ...(images === "kitty" || images === "iterm2"
        ? { images }
        : images === false
          ? { images: null }
          : {}),
      ...(typeof terminal?.trueColor === "boolean" ? { trueColor: terminal.trueColor } : {}),
      ...(typeof terminal?.hyperlinks === "boolean" ? { hyperlinks: terminal.hyperlinks } : {}),
    };
  }

  setTuiMode(mode: settingsSchemaTypes.TuiMode): void {
    this.setGlobalSetting("tuiMode", mode);
  }

  setFullscreenExitOutput(output: settingsSchemaTypes.FullscreenExitOutput): void {
    this.setGlobalSetting("fullscreenExitOutput", output);
  }

  setFullscreenWheelScrollLines(lines: tuiTypes.WheelScrollLines): void {
    this.globalSettings.fullscreenWheelScrollLines =
      lines === "auto" ? lines : Math.max(1, Math.min(100, Math.floor(lines)));
    this.markModified("fullscreenWheelScrollLines");
    this.save();
  }
}
