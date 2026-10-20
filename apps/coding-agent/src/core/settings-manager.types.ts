import type FileSettingsStorageClass from "./file-settings-storage.ts";
import type InMemorySettingsStorageClass from "./in-memory-settings-storage.ts";
import type SettingsManagerClass from "./settings-manager.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

declare namespace settingsManagerTypes {
  type SettingsScope = "global" | "project";

  interface SettingsManagerCreateOptions {
    projectTrusted?: boolean;
  }

  interface SettingsStorage {
    withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
  }

  interface SettingsError {
    scope: SettingsScope;
    path?: string;
    error: Error;
  }

  type FileSettingsStorage = (typeof FileSettingsStorageClass)["prototype"];

  type InMemorySettingsStorage = (typeof InMemorySettingsStorageClass)["prototype"];

  type SettingsManager = (typeof SettingsManagerClass)["prototype"];

  type BranchSummarySettings = settingsSchemaTypes.BranchSummarySettings;

  type CacheWarmingMode = settingsSchemaTypes.CacheWarmingMode;

  type CodemodeMode = settingsSchemaTypes.CodemodeMode;

  type CodemodeSettings = settingsSchemaTypes.CodemodeSettings;

  type CompactionModelOverride = settingsSchemaTypes.CompactionModelOverride;

  type CompactionSettings = settingsSchemaTypes.CompactionSettings;

  type DefaultProjectTrust = settingsSchemaTypes.DefaultProjectTrust;

  type FullscreenExitOutput = settingsSchemaTypes.FullscreenExitOutput;

  type ImageSettings = settingsSchemaTypes.ImageSettings;

  type MarkdownSettings = settingsSchemaTypes.MarkdownSettings;

  type MemorySettings = settingsSchemaTypes.MemorySettings;

  type MermaidRenderingMode = settingsSchemaTypes.MermaidRenderingMode;

  type ModelPolicySettings = settingsSchemaTypes.ModelPolicySettings;

  type PackageSource = settingsSchemaTypes.PackageSource;

  type ProviderRetrySettings = settingsSchemaTypes.ProviderRetrySettings;

  type QuietStartup = settingsSchemaTypes.QuietStartup;

  type RetrySettings = settingsSchemaTypes.RetrySettings;

  type Settings = settingsSchemaTypes.Settings;

  type TerminalSettings = settingsSchemaTypes.TerminalSettings;

  type ThinkingBudgetsSettings = settingsSchemaTypes.ThinkingBudgetsSettings;

  type TransportSetting = settingsSchemaTypes.TransportSetting;

  type TuiMode = settingsSchemaTypes.TuiMode;
}

export type { settingsManagerTypes as default };
