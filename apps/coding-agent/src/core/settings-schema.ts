import settingsSchemaPart1 from "./settings-schema-part1.ts";
import settingsSchemaPart2 from "./settings-schema-part2.ts";
import settingsSchemaPart3 from "./settings-schema-part3.ts";

const {
  BranchSummarySettingsSchema,
  CodemodeModeSchema,
  CodemodeSettingsSchema,
  CompactionModelOverrideSchema,
  CompactionSettingsSchema,
  ImageSettingsSchema,
  MarkdownSettingsSchema,
  MemorySettingsSchema,
  ProviderRetrySettingsSchema,
  RetrySettingsSchema,
  TerminalSettingsSchema,
  ThinkingBudgetsSettingsSchema,
} = settingsSchemaPart1;
const { ModelPolicySettingsSchema, PackageSourceSchema, PrWatchSettingsSchema } =
  settingsSchemaPart2;
const { SettingsSchema } = settingsSchemaPart3;

const settingsSchema = {
  BranchSummarySettingsSchema,
  CodemodeModeSchema,
  CodemodeSettingsSchema,
  CompactionModelOverrideSchema,
  CompactionSettingsSchema,
  ImageSettingsSchema,
  MarkdownSettingsSchema,
  MemorySettingsSchema,
  ModelPolicySettingsSchema,
  PackageSourceSchema,
  PrWatchSettingsSchema,
  ProviderRetrySettingsSchema,
  RetrySettingsSchema,
  SettingsSchema,
  TerminalSettingsSchema,
  ThinkingBudgetsSettingsSchema,
};

export default settingsSchema;
