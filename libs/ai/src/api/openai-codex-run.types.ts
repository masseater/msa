import type typesModule from "../types.types.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";

declare namespace openaiCodexRunTypes {
  interface CodexStreamStart {
    readonly model: typesModule.Model<"openai-codex-responses">;
    readonly context: typesModule.TranscriptContext;
    readonly options: openaiCodexOptionsTypes.OpenAICodexResponsesOptions | undefined;
  }
}

export type { openaiCodexRunTypes as default };
