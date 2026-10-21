import { Stream } from "effect";

import type openaiCompletionsPromptCacheMockTypes from "./openai-completions-prompt-cache-mock.types.ts";

const mockState = {
  lastClientOptions: undefined as
    | openaiCompletionsPromptCacheMockTypes.FakeOpenAIClientOptions
    | undefined,
  lastParams: undefined as
    | openaiCompletionsPromptCacheMockTypes.CapturedCompletionsPayload
    | undefined,
};

const finalChunk = {
  choices: [{ delta: {}, finish_reason: "stop" }],
  usage: {
    completion_tokens: 1,
    completion_tokens_details: { reasoning_tokens: 0 },
    prompt_tokens: 1,
    prompt_tokens_details: { cached_tokens: 0 },
  },
};

class FakeOpenAI {
  chat = {
    completions: {
      create: (params: openaiCompletionsPromptCacheMockTypes.CapturedCompletionsPayload) => {
        mockState.lastParams = params;
        const stream = {
          [Symbol.asyncIterator]() {
            return Stream.toAsyncIterable(Stream.make(finalChunk))[Symbol.asyncIterator]();
          },
        };
        const promise = Promise.resolve(stream) as Promise<typeof stream> & {
          withResponse: () => Promise<{
            data: typeof stream;
            response: { status: number; headers: Headers };
          }>;
        };
        promise.withResponse = () =>
          Promise.resolve({ data: stream, response: { headers: new Headers(), status: 200 } });
        return promise;
      },
    },
  };

  constructor(options: openaiCompletionsPromptCacheMockTypes.FakeOpenAIClientOptions) {
    mockState.lastClientOptions = options;
  }
}

const openaiCompletionsPromptCacheMock = { default: FakeOpenAI, mockState };

export default openaiCompletionsPromptCacheMock;
