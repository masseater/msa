import type { Static } from "typebox";

import type openaiCompatSchema from "./openai-compat-schema.ts";

declare namespace openaiCompatSchemaTypes {
  interface OpenAICompletionsCompat extends Static<
    typeof openaiCompatSchema.OpenAICompletionsCompatSchema
  > {}

  interface OpenAIResponsesCompat extends Static<
    typeof openaiCompatSchema.OpenAIResponsesCompatSchema
  > {}
}

export type { openaiCompatSchemaTypes as default };
