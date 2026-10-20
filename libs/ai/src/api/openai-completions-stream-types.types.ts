import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type constrainedSamplingTypes from "./constrained-sampling.types.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

declare namespace openaiCompletionsStreamTypesModule {
  interface StreamingToolCallBlock extends typesModule.ToolCall {
    partialArgs?: string | undefined;
    customInput?:
      | { property: string; jsonBuffer: constrainedSamplingTypes.GrammarToolInputJsonBuffer }
      | undefined;
    streamIndex?: number | undefined;
  }

  type StreamingBlock =
    | typesModule.TextContent
    | typesModule.ThinkingContent
    | StreamingToolCallBlock;

  interface StreamingToolCallDelta {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
    custom?: { name?: string; input?: string };
  }

  interface CompletionsStreamState {
    readonly events: eventStreamTypes.AssistantMessageEventStream;
    readonly output: typesModule.AssistantMessage;
    readonly model: typesModule.Model<"openai-completions">;
    readonly options: openaiCompletionsTypesModule.OpenAICompletionsOptions | undefined;
    readonly compat: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat;
    readonly grammarToolInputProperties: ReadonlyMap<string, string>;
    readonly blocks: StreamingBlock[];
    readonly toolCallBlocksByIndex: Map<number, StreamingToolCallBlock>;
    readonly toolCallBlocksById: Map<string, StreamingToolCallBlock>;
    textBlock: typesModule.TextContent | null;
    thinkingBlock: typesModule.ThinkingContent | null;
    streamedReasoningDetails: openaiCompletionsTypesModule.OpenAIReasoningDetail[] | undefined;
    hasFinishReason: boolean;
  }
}

export type { openaiCompletionsStreamTypesModule as default };
