import type Anthropic from "@anthropic-ai/sdk";
type ResponseContentBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "text"; text: string };

function createSseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const body = events
    .map(({ event, data }) => {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      return `event: ${event}\ndata: ${payload}\n`;
    })
    .join("\n");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

const tokenUsage = (inputTokens: number, outputTokens: number) => ({
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  input_tokens: inputTokens,
  output_tokens: outputTokens,
});

const sse = {
  blockDelta: (index: number, delta: object) => ({
    data: { delta, index, type: "content_block_delta" },
    event: "content_block_delta",
  }),
  blockStart: (index: number, contentBlock: object) => ({
    data: { content_block: contentBlock, index, type: "content_block_start" },
    event: "content_block_start",
  }),
  blockStop: (index: number) => ({
    data: { index, type: "content_block_stop" },
    event: "content_block_stop",
  }),
  messageDelta: (delta: object, inputTokens = 12, outputTokens = 5) => ({
    data: { delta, type: "message_delta", usage: tokenUsage(inputTokens, outputTokens) },
    event: "message_delta",
  }),
  messageStart: (id: string, inputTokens = 12) => ({
    data: { message: { id, usage: tokenUsage(inputTokens, 0) }, type: "message_start" },
    event: "message_start",
  }),
  messageStop: { data: { type: "message_stop" }, event: "message_stop" },
};

const minimalAnthropicEvents = [
  sse.messageStart("msg_test"),
  sse.blockStart(0, { text: "", type: "text" }),
  sse.blockDelta(0, { text: "Hello", type: "text_delta" }),
  sse.blockStop(0),
  sse.messageDelta({ stop_reason: "end_turn" }),
  sse.messageStop,
];

function createFakeAnthropicClient(response: Response): Anthropic {
  return {
    beta: {
      messages: {
        create: () => ({
          asResponse: () => Promise.resolve(response),
        }),
      },
    },
  } as unknown as Anthropic;
}

function createResponseModelSseResponse(
  model: string,
  contentBlock: ResponseContentBlock,
): Response {
  return createSseResponse([
    {
      data: {
        message: {
          id: "msg_response_model",
          model,
          usage: { input_tokens: 100, output_tokens: 0 },
        },
        type: "message_start",
      },
      event: "message_start",
    },
    {
      data: { content_block: contentBlock, index: 0, type: "content_block_start" },
      event: "content_block_start",
    },
    { data: { index: 0, type: "content_block_stop" }, event: "content_block_stop" },
    {
      data: {
        delta: { stop_reason: "end_turn" },
        type: "message_delta",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      event: "message_delta",
    },
    { data: { type: "message_stop" }, event: "message_stop" },
  ]);
}

const anthropicSseParsingSupport = {
  createFakeAnthropicClient,
  createResponseModelSseResponse,
  createSseResponse,
  minimalAnthropicEvents,
  sse,
};

export default anthropicSseParsingSupport;
