import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import type openaiResponsesReasoningTypes from "./openai-responses-reasoning.types.ts";

declare namespace openaiResponsesConfigTypes {
  interface OpenAIResponsesOptions extends openaiResponsesReasoningTypes.ResponsesReasoningOptions {
    serviceTier?: ResponseCreateParamsStreaming["service_tier"] | undefined;
  }

  type ResolvedResponsesCompat = Required<typesModule.OpenAIResponsesCompat>;
}

export type { openaiResponsesConfigTypes as default };
