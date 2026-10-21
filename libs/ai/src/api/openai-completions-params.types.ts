import type typesModule from "../types.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import type openaiCompletionsCompatTypes from "./openai-completions-compat.types.ts";
declare namespace openaiCompletionsParamsTypes {
  interface BuildParamsInput {
    readonly model: typesModule.Model<"openai-completions">;
    readonly context: transcriptTypes.TranscriptContext;
    readonly options: openaiCompletionsCompatTypes.OpenAICompletionsOptions | undefined;
    readonly compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat;
    readonly cacheRetention: typesModule.CacheRetention;
    readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  }
}

export type { openaiCompletionsParamsTypes as default };
