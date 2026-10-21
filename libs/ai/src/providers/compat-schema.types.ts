import type { Static } from "typebox";

import type compatSchema from "./compat-schema.ts";

declare namespace compatSchemaTypes {
  interface AnthropicMessagesCompat extends Static<
    typeof compatSchema.AnthropicMessagesCompatSchema
  > {}
}

export type { compatSchemaTypes as default };
