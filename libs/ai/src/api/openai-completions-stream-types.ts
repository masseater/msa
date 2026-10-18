import type { AssistantMessage, Model, TextContent, ThinkingContent, ToolCall } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import type { GrammarToolInputJsonBuffer } from "./constrained-sampling.ts";
import type {
  OpenAICompletionsOptions,
  OpenAIReasoningDetail,
  ResolvedOpenAICompletionsCompat,
} from "./openai-completions-types.ts";

interface StreamingToolCallBlock extends ToolCall {
  partialArgs?: string | undefined;
  customInput?: { property: string; jsonBuffer: GrammarToolInputJsonBuffer } | undefined;
  streamIndex?: number | undefined;
}

type StreamingBlock = TextContent | ThinkingContent | StreamingToolCallBlock;

interface StreamingToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  custom?: { name?: string; input?: string };
}

interface CompletionsStreamState {
  readonly events: AssistantMessageEventStream;
  readonly output: AssistantMessage;
  readonly model: Model<"openai-completions">;
  readonly options: OpenAICompletionsOptions | undefined;
  readonly compat: ResolvedOpenAICompletionsCompat;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  readonly blocks: StreamingBlock[];
  readonly toolCallBlocksByIndex: Map<number, StreamingToolCallBlock>;
  readonly toolCallBlocksById: Map<string, StreamingToolCallBlock>;
  textBlock: TextContent | null;
  thinkingBlock: ThinkingContent | null;
  streamedReasoningDetails: OpenAIReasoningDetail[] | undefined;
  hasFinishReason: boolean;
}

export type {
  CompletionsStreamState,
  StreamingBlock,
  StreamingToolCallBlock,
  StreamingToolCallDelta,
};
