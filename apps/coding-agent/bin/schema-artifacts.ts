import compatSchema from "@msa/ai/providers/compat-schema";
import modelSchema from "@msa/ai/providers/model-schema";

import keybindingsSchema from "../src/core/keybindings-schema.ts";
import modelConfigSupport from "../src/core/model-config-support.ts";
import settingsSchema from "../src/core/settings-schema.ts";
import themeSchema from "../src/modes/interactive/theme/theme-schema.ts";
import type schemaArtifactsTypes from "./schema-artifacts.types.ts";

const { ModelsConfigSchema } = modelConfigSupport;
const { SettingsSchema } = settingsSchema;
const { KeybindingValueSchema, KeybindingsSchema } = keybindingsSchema;
const { ColorValueSchema, ThemeJsonSchema } = themeSchema;

const {
  ModelCostSchema,
  ModelInputLimitsSchema,
  ModelPromptCacheSchema,
  ModelThinkingLevelSchema,
  ThinkingLevelMapSchema,
} = modelSchema;
const { ProviderCompatSchema } = compatSchema;

const schemaArtifacts: readonly schemaArtifactsTypes.SchemaArtifact[] = [
  {
    definitions: {
      ModelCost: ModelCostSchema,
      ModelInputLimits: ModelInputLimitsSchema,
      ModelPromptCache: ModelPromptCacheSchema,
      ProviderCompat: ProviderCompatSchema,
      ThinkingLevelMap: ThinkingLevelMapSchema,
    },
    filename: "models.schema.json",
    schema: ModelsConfigSchema,
  },
  {
    definitions: { ModelThinkingLevel: ModelThinkingLevelSchema },
    filename: "settings.schema.json",
    schema: SettingsSchema,
  },
  {
    definitions: { KeybindingValue: KeybindingValueSchema },
    filename: "keybindings.schema.json",
    schema: KeybindingsSchema,
  },
  {
    definitions: { ColorValue: ColorValueSchema },
    filename: "theme.schema.json",
    schema: ThemeJsonSchema,
  },
];

const schemaArtifactsModule = {
  schemaArtifacts,
};

export default schemaArtifactsModule;
