import type typesModule from "../types.types.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";

declare namespace openaiCodexBodyTypes {
  type CodexModel = typesModule.Model<"openai-codex-responses">;

  interface CodexBodyRequest {
    readonly model: CodexModel;
    readonly context: typesModule.TranscriptContext;
    readonly options: openaiCodexOptionsTypes.OpenAICodexResponsesOptions | undefined;
    readonly cacheSessionId: string | undefined;
    readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  }
}

export type { openaiCodexBodyTypes as default };
