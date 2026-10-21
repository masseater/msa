import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";

declare namespace openaiCodexStreamRunTypes {
  interface CodexStreamRun {
    readonly model: typesModule.Model<"openai-codex-responses">;
    readonly output: typesModule.AssistantMessage;
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    readonly options: openaiCodexOptionsTypes.OpenAICodexResponsesOptions | undefined;
    readonly body: openaiCodexOptionsTypes.CodexRequestBody;
    readonly bodyJson: string;
    readonly sseHeaders: Headers;
    readonly websocketHeaders: Headers;
    readonly httpTimeoutMs: number | undefined;
    readonly websocketConnectTimeoutMs: number | undefined;
    readonly cacheSessionId: string | undefined;
    readonly accountId: string;
    readonly grammarToolInputProperties: ReadonlyMap<string, string>;
    readonly transport: NonNullable<typesModule.StreamOptions["transport"]>;
    readonly emitStart: () => void;
  }

  interface CodexFailure {
    readonly output: typesModule.AssistantMessage;
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    readonly options: openaiCodexOptionsTypes.OpenAICodexResponsesOptions | undefined;
  }
}

export type { openaiCodexStreamRunTypes as default };
