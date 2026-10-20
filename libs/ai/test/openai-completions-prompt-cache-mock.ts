import { Stream } from "effect";

interface FakeOpenAIClientOptions {
  apiKey: string;
  baseURL: string;
  dangerouslyAllowBrowser: boolean;
  defaultHeaders?: Record<string, string>;
}

interface CapturedCompletionsPayload {
  prompt_cache_key?: string;
  prompt_cache_retention?: "24h" | "in-memory" | null;
  session_id?: string;
}

const mockState = {
  lastClientOptions: undefined as FakeOpenAIClientOptions | undefined,
  lastParams: undefined as CapturedCompletionsPayload | undefined,
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
      create: (params: CapturedCompletionsPayload) => {
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

  constructor(options: FakeOpenAIClientOptions) {
    mockState.lastClientOptions = options;
  }
}

const openaiCompletionsPromptCacheMock = { default: FakeOpenAI, mockState };

export default openaiCompletionsPromptCacheMock;
