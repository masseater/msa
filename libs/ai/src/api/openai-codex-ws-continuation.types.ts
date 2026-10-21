import type typesModule from "../types.types.ts";

declare namespace openaiCodexWsContinuationTypes {
  interface ResponseItemsSource {
    readonly model: typesModule.Model<"openai-codex-responses">;
    readonly output: typesModule.AssistantMessage;
    readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  }
}

export type { openaiCodexWsContinuationTypes as default };
