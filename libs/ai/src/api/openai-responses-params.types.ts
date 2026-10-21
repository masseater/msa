import type typesModule from "../types.types.ts";
import type openaiResponsesConfigTypes from "./openai-responses-config.types.ts";

declare namespace openaiResponsesParamsTypes {
  interface OpenAIResponsesParamsRequest {
    readonly model: typesModule.Model<"openai-responses">;
    readonly context: typesModule.TranscriptContext;
    readonly options: openaiResponsesConfigTypes.OpenAIResponsesOptions | undefined;
    readonly compat: openaiResponsesConfigTypes.ResolvedResponsesCompat;
    readonly grammarToolInputProperties: ReadonlyMap<string, string>;
    readonly configurationUpdateEffort: string | undefined;
  }
}

export type { openaiResponsesParamsTypes as default };
