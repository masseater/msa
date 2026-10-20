import { Stream } from "effect";

const mockState = {
  chunks: undefined as
    | Array<null | {
        id?: string;
        choices?: Array<{
          delta: Record<string, unknown>;
          finish_reason: string | null;
          usage?: unknown;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          prompt_tokens_details: { cached_tokens: number; cache_write_tokens?: number };
          completion_tokens_details: { reasoning_tokens: number };
        };
      }>
    | undefined,
  lastParams: undefined as unknown,
};

class FakeOpenAI {
  chat = {
    completions: {
      create: (params: unknown) => {
        mockState.lastParams = params;
        const fakeStream = {
          [Symbol.asyncIterator]() {
            return Stream.toAsyncIterable(
              Stream.fromIterable(
                (function* () {
                  const chunks = mockState.chunks ?? [
                    {
                      choices: [{ delta: {}, finish_reason: "stop" }],
                      usage: {
                        completion_tokens: 1,
                        completion_tokens_details: { reasoning_tokens: 0 },
                        prompt_tokens: 1,
                        prompt_tokens_details: { cached_tokens: 0 },
                      },
                    },
                  ];
                  for (const chunk of chunks) {
                    yield chunk;
                  }
                })(),
              ),
            )[Symbol.asyncIterator]();
          },
        };
        const promise = Promise.resolve(fakeStream) as Promise<typeof fakeStream> & {
          withResponse: () => Promise<{
            data: typeof fakeStream;
            response: { status: number; headers: Headers };
          }>;
        };
        promise.withResponse = () =>
          Promise.resolve({
            data: fakeStream,
            response: { headers: new Headers(), status: 200 },
          });
        return promise;
      },
    },
  };
}

const openaiCompletionsToolChoiceMock = { default: FakeOpenAI, mockState };

export default openaiCompletionsToolChoiceMock;
