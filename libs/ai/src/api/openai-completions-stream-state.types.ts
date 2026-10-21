import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";
declare namespace openaiCompletionsStreamStateTypes {
  interface CreateStateInput {
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    readonly model: typesModule.Model<"openai-completions">;
    readonly context: transcriptTypes.TranscriptContext;
    readonly options: openaiCompletionsTypesModule.OpenAICompletionsOptions | undefined;
    readonly compat: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat;
  }
}

export type { openaiCompletionsStreamStateTypes as default };
