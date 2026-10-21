import type { TSchema } from "typebox";
import { Type } from "typebox";

import displayProperties from "./settings-schema/display-properties.ts";
import modelProperties from "./settings-schema/models-properties.ts";
import resourceSchemas from "./settings-schema/resource-schemas.ts";
import resourceProperties from "./settings-schema/resources-properties.ts";
import sectionSchemas from "./settings-schema/section-schemas.ts";
import sessionProperties from "./settings-schema/session-properties.ts";
import telemetryProperties from "./settings-schema/telemetry-properties.ts";

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
} = sectionSchemas;
const { ModelPolicySettingsSchema, PackageSourceSchema, PrWatchSettingsSchema } = resourceSchemas;

const inKeyOrder = <T extends Record<string, TSchema>>(properties: T): T =>
  Object.fromEntries(
    Object.entries(properties).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ) as T;

const SettingsSchema = Type.Object(
  inKeyOrder({
    $schema: Type.Optional(Type.String({ description: "JSON Schema reference." })),
    ...displayProperties,
    ...modelProperties,
    ...resourceProperties,
    ...sessionProperties,
    ...telemetryProperties,
  }),
  { additionalProperties: true },
);

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
