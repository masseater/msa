import { Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";

function createMockResponsesStream(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          response: { id: "resp_wrapper_early_eof" },
          sequence_number: 0,
          type: "response.created",
        } as ResponseStreamEvent;
        yield {
          item: { id: "rs_wrapper_early_eof", summary: [], type: "reasoning" },
          output_index: 0,
          sequence_number: 1,
          type: "response.output_item.added",
        } as ResponseStreamEvent;
        yield {
          content_index: 0,
          delta: "partial reasoning before the wrapper stream ends",
          item_id: "rs_wrapper_early_eof",
          output_index: 0,
          sequence_number: 2,
          type: "response.reasoning_text.delta",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

class FakeOpenAI {
  responses = {
    create: () => {
      const responseStream = createMockResponsesStream();
      const promise = Promise.resolve(responseStream) as Promise<
        AsyncIterable<ResponseStreamEvent>
      > & {
        withResponse: () => Promise<{
          data: AsyncIterable<ResponseStreamEvent>;
          response: { status: number; headers: Headers };
        }>;
      };
      promise.withResponse = () =>
        Promise.resolve({
          data: responseStream,
          response: { headers: new Headers(), status: 200 },
        });
      return promise;
    },
  };
}

const openaiResponsesTerminalEventMock = { default: FakeOpenAI };

export default openaiResponsesTerminalEventMock;
