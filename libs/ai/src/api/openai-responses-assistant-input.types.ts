import type typesModule from "../types.types.ts";
import type openaiResponsesOptionsTypes from "./openai-responses-options.ts";

declare namespace openaiResponsesAssistantInputTypes {
  interface AssistantConversion<TApi extends typesModule.Api> {
    readonly model: typesModule.Model<TApi>;
    readonly message: typesModule.AssistantMessage;
    readonly msgIndex: number;
    readonly options: openaiResponsesOptionsTypes.ConvertResponsesMessagesOptions | undefined;
  }
}

export type { openaiResponsesAssistantInputTypes as default };
