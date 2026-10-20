import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { Type } from "typebox";

import type anthropicMessagesTypes from "../src/api/anthropic-messages.types.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;

const grammarError =
  "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.";

const model: typesModule.Model<"anthropic-messages"> = {
  api: "anthropic-messages",
  baseUrl: "https://anthropic.example",
  compat: { supportsStrictTools: true },
  contextWindow: 200000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "claude-haiku-4-5",
  input: ["text"],
  maxTokens: 100,
  name: "Test Claude",
  provider: "anthropic-api",
  reasoning: false,
};

function tool(name: string, strict?: "prefer" | "require"): typesModule.Tool {
  return {
    description: "Look up a value",
    name,
    parameters: Type.Object({ optional: Type.Optional(Type.Number()), value: Type.String() }),
    ...(strict === undefined ? {} : { constrainedSampling: { strict, type: "json_schema" } }),
  };
}

function context(tools: typesModule.Tool[]): typesModule.TranscriptContext {
  return normalizeContext({ messages: [{ content: "Hello", role: "user", timestamp: 1 }], tools });
}

function errorResponse(
  message = grammarError,
  status = 400,
  type = "invalid_request_error",
): Response {
  return Response.json({ error: { message, type }, type: "error" }, { status });
}

function successResponse(): Response {
  const events = [
    {
      message: { id: "msg_test", model: model.id, usage: { input_tokens: 10, output_tokens: 0 } },
      type: "message_start",
    },
    { delta: { stop_reason: "end_turn" }, type: "message_delta", usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function harness(respond: (payload: MessageCreateParamsStreaming, attempt: number) => Response) {
  const payloads: MessageCreateParamsStreaming[] = [];
  const fetch: NonNullable<anthropicMessagesTypes.AnthropicOptions["fetch"]> = (_input, init) => {
    const payload = JSON.parse(init?.body as string) as MessageCreateParamsStreaming;
    payloads.push(payload);
    return Promise.resolve(respond(payload, payloads.length));
  };
  return {
    options: {
      apiKey: "test-key",
      fetch,
      maxRetries: 0,
    } satisfies anthropicMessagesTypes.AnthropicOptions,
    payloads,
  };
}

const anthropicStrictToolFallbackSupport = {
  context,
  errorResponse,
  grammarError,
  harness,
  model,
  successResponse,
  tool,
};

export default anthropicStrictToolFallbackSupport;
