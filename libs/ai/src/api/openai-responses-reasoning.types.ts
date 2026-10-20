import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";

declare namespace openaiResponsesReasoningTypes {
  interface ResponsesReasoningOptions extends typesModule.StreamOptions {
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
    reasoningSummary?: "auto" | "detailed" | "concise" | null | undefined;
    toolChoice?: ResponseCreateParamsStreaming["tool_choice"] | undefined;
  }

  interface ReasoningRequest<TApi extends typesModule.Api> {
    readonly model: typesModule.Model<TApi>;
    readonly options: ResponsesReasoningOptions | undefined;
    readonly effortOverride?: string | undefined;
  }

  interface SimpleResponsesRequest<TApi extends typesModule.Api> {
    readonly model: typesModule.Model<TApi>;
    readonly context: typesModule.TranscriptContext;
    readonly options: typesModule.SimpleStreamOptions | undefined;
    readonly apiKey: string | undefined;
  }
}

export type { openaiResponsesReasoningTypes as default };
