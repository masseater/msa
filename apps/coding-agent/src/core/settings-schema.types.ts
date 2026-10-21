import type { Static } from "typebox";

import type settingsSchema from "./settings-schema.ts";

declare namespace settingsSchemaTypes {
  type SettingsInput = Static<typeof settingsSchema.SettingsSchema>;

  interface CompactionModelOverride extends Static<
    typeof settingsSchema.CompactionModelOverrideSchema
  > {}

  interface CompactionSettings extends Static<typeof settingsSchema.CompactionSettingsSchema> {}

  interface BranchSummarySettings extends Static<
    typeof settingsSchema.BranchSummarySettingsSchema
  > {}

  interface ProviderRetrySettings extends Static<
    typeof settingsSchema.ProviderRetrySettingsSchema
  > {}

  interface RetrySettings extends Omit<
    Static<typeof settingsSchema.RetrySettingsSchema>,
    "maxDelayMs"
  > {}

  interface TerminalSettings extends Static<typeof settingsSchema.TerminalSettingsSchema> {}

  interface ImageSettings extends Static<typeof settingsSchema.ImageSettingsSchema> {}

  interface MemorySettings extends Static<typeof settingsSchema.MemorySettingsSchema> {}

  interface PrWatchSettings extends Static<typeof settingsSchema.PrWatchSettingsSchema> {}

  interface ThinkingBudgetsSettings extends Static<
    typeof settingsSchema.ThinkingBudgetsSettingsSchema
  > {}

  type MermaidRenderingMode = NonNullable<
    Static<typeof settingsSchema.MarkdownSettingsSchema>["mermaid"]
  >;

  interface MarkdownSettings extends Static<typeof settingsSchema.MarkdownSettingsSchema> {}

  type CodemodeMode = Static<typeof settingsSchema.CodemodeModeSchema>;

  interface CodemodeSettings extends Static<typeof settingsSchema.CodemodeSettingsSchema> {}

  interface ModelPolicySettings extends Static<typeof settingsSchema.ModelPolicySettingsSchema> {}

  type DefaultProjectTrust = NonNullable<SettingsInput["defaultProjectTrust"]>;

  type QuietStartup = NonNullable<SettingsInput["quietStartup"]>;

  type TransportSetting = NonNullable<SettingsInput["transport"]>;

  type PackageSource = Static<typeof settingsSchema.PackageSourceSchema>;

  type FullscreenExitOutput = NonNullable<SettingsInput["fullscreenExitOutput"]>;

  type TuiMode = NonNullable<SettingsInput["tuiMode"]>;

  type CacheWarmingMode = NonNullable<SettingsInput["cacheWarming"]>;

  interface Settings extends Omit<SettingsInput, "queueMode" | "retry" | "skills" | "websockets"> {
    retry?: RetrySettings;
    skills?: string[];
  }
}

export type { settingsSchemaTypes as default };
