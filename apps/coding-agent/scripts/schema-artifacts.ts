import { ProviderCompatSchema } from "@msa/ai/providers/compat-schema";
import {
  ModelCostSchema,
  ModelInputLimitsSchema,
  ModelPromptCacheSchema,
  ModelThinkingLevelSchema,
  ThinkingLevelMapSchema,
} from "@msa/ai/providers/model-schema";
import type { TSchema } from "typebox";

import { KeybindingsSchema, KeybindingValueSchema } from "../src/core/keybindings-schema.ts";
import { ModelsConfigSchema } from "../src/core/model-config.ts";
import { SettingsSchema } from "../src/core/settings-schema.ts";
import { ColorValueSchema, ThemeJsonSchema } from "../src/modes/interactive/theme/theme-schema.ts";

interface SchemaArtifact {
  filename: `${string}.schema.json`;
  schema: TSchema;
  definitions?: Readonly<Record<string, TSchema>>;
}

const schemaArtifacts: readonly SchemaArtifact[] = [
  {
    filename: "models.schema.json",
    schema: ModelsConfigSchema,
    definitions: {
      ModelCost: ModelCostSchema,
      ModelInputLimits: ModelInputLimitsSchema,
      ModelPromptCache: ModelPromptCacheSchema,
      ProviderCompat: ProviderCompatSchema,
      ThinkingLevelMap: ThinkingLevelMapSchema,
    },
  },
  {
    filename: "settings.schema.json",
    schema: SettingsSchema,
    definitions: { ModelThinkingLevel: ModelThinkingLevelSchema },
  },
  {
    filename: "keybindings.schema.json",
    schema: KeybindingsSchema,
    definitions: { KeybindingValue: KeybindingValueSchema },
  },
  {
    filename: "theme.schema.json",
    schema: ThemeJsonSchema,
    definitions: { ColorValue: ColorValueSchema },
  },
];

export type { SchemaArtifact };
export { schemaArtifacts };
