import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";

declare namespace openaiCodexEventsTypes {
  type CodexModel = typesModule.Model<"openai-codex-responses">;

  interface CodexEventsRun {
    readonly model: CodexModel;
    readonly output: typesModule.AssistantMessage;
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    readonly options: openaiCodexOptionsTypes.OpenAICodexResponsesOptions | undefined;
    readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  }
}

export type { openaiCodexEventsTypes as default };
