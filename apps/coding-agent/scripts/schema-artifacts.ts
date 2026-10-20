import compatSchema from "@msa/ai/providers/compat-schema";
import modelSchema from "@msa/ai/providers/model-schema";
import type { TSchema } from "typebox";

import { KeybindingValueSchema, KeybindingsSchema } from "../src/core/keybindings-schema.ts";
import { ModelsConfigSchema } from "../src/core/model-config.ts";
import { SettingsSchema } from "../src/core/settings-schema.ts";
import { ColorValueSchema, ThemeJsonSchema } from "../src/modes/interactive/theme/theme-schema.ts";

const {
  ModelCostSchema,
  ModelInputLimitsSchema,
  ModelPromptCacheSchema,
  ModelThinkingLevelSchema,
  ThinkingLevelMapSchema,
} = modelSchema;
const { ProviderCompatSchema } = compatSchema;

interface SchemaArtifact {
  filename: `${string}.schema.json`;
  schema: TSchema;
  definitions?: Readonly<Record<string, TSchema>>;
}

const schemaArtifacts: readonly SchemaArtifact[] = [
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

export { schemaArtifacts };
export type { SchemaArtifact };
