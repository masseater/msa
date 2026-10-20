import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type { Stream as OpenAIStream } from "openai/streaming";
declare namespace openaiCompletionsRequestTypes {
  interface ChatStreamResult {
    readonly data: OpenAIStream<ChatCompletionChunk>;
    readonly response: Response;
  }
}

export type { openaiCompletionsRequestTypes as default };
