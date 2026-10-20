import type OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import type openaiResponsesOptionsTypes from "./openai-responses-options.ts";

declare namespace openaiResponsesRunTypes {
  interface ResponsesRequest {
    readonly client: Pick<OpenAI, "responses">;
    readonly params: ResponseCreateParamsStreaming;
    readonly streamOptions: openaiResponsesOptionsTypes.OpenAIResponsesStreamOptions;
  }

  interface ResponsesRunSpec<TApi extends typesModule.Api> {
    readonly model: typesModule.Model<TApi>;
    readonly options: typesModule.StreamOptions | undefined;
    readonly output: typesModule.AssistantMessage;
    readonly streamName: string;
    readonly prepare: () => ResponsesRequest;
    readonly formatError: (error: unknown) => string;
  }
}

export type { openaiResponsesRunTypes as default };
