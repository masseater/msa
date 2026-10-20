import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type constrainedSamplingTypes from "./constrained-sampling.types.ts";
import type openaiResponsesOptionsTypes from "./openai-responses-options.ts";

declare namespace openaiResponsesStreamStateTypes {
  type StreamingToolCall = typesModule.ToolCall & {
    partialJson?: string;
    customInput?: {
      property: string;
      jsonBuffer: constrainedSamplingTypes.GrammarToolInputJsonBuffer;
    };
  };

  type SlotBody =
    | { readonly type: "thinking"; readonly block: typesModule.ThinkingContent }
    | { readonly type: "text"; readonly block: typesModule.TextContent }
    | { readonly type: "toolCall"; readonly block: StreamingToolCall };

  type ResponsesOutputSlot = SlotBody & { readonly contentIndex: number };

  type ToolCallOutputSlot = Extract<ResponsesOutputSlot, { type: "toolCall" }>;

  interface ResponsesStreamState<TApi extends typesModule.Api> {
    readonly output: typesModule.AssistantMessage;
    readonly stream: eventStreamTypes.AssistantMessageEventStream;
    readonly model: typesModule.Model<TApi>;
    readonly options: openaiResponsesOptionsTypes.OpenAIResponsesStreamOptions | undefined;
    readonly slots: Map<number, ResponsesOutputSlot>;
    readonly reasoningBlocksById: Map<string, typesModule.ThinkingContent>;
    sawTerminalResponseEvent: boolean;
  }

  interface CustomInputUpdate {
    readonly block: StreamingToolCall;
    readonly nextInput: string;
    readonly close: boolean;
  }
}

export type { openaiResponsesStreamStateTypes as default };
