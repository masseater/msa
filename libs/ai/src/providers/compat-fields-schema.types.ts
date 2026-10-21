import type { Static } from "typebox";

import type compatFieldsSchema from "./compat-fields-schema.ts";

declare namespace compatFieldsSchemaTypes {
  type ChatTemplateKwargValue = Static<typeof compatFieldsSchema.ChatTemplateKwargValueSchema>;

  type ThinkingTokenBudgetField = Static<typeof compatFieldsSchema.ThinkingTokenBudgetFieldSchema>;

  type SessionAffinityFormat = Static<typeof compatFieldsSchema.SessionAffinityFormatSchema>;
}

export type { compatFieldsSchemaTypes as default };
