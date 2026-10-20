import type typesModule from "../types.types.ts";
import type openaiResponsesConfigTypes from "./openai-responses-config.types.ts";

declare namespace openaiResponsesRequestTypes {
  type ResponsesModel = typesModule.Model<"openai-responses">;

  interface OpenAIResponsesRequestSpec {
    readonly model: ResponsesModel;
    readonly context: typesModule.TranscriptContext;
    readonly options: openaiResponsesConfigTypes.OpenAIResponsesOptions | undefined;
    readonly configurationUpdateEffort: string | undefined;
  }
}

export type { openaiResponsesRequestTypes as default };
