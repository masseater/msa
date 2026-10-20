import { Type } from "typebox";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { AssistantMessage, Model, Tool } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
const reasoningDetail = { data: "encrypted-signature", id: "call_1", type: "reasoning.encrypted" };

const readTool: Tool = {
  description: "Read a file",
  name: "read",
  parameters: Type.Object({ path: Type.String() }),
};

function model(): Model<"openai-completions"> {
  return {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 100_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "google/gemini-test",
    input: ["text"],
    maxTokens: 4096,
    name: "Gemini Test",
    provider: "openrouter",
    reasoning: true,
  };
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): unknown {
  return {
    choices: [{ delta, finish_reason: finishReason, index: 0 }],
    id: "chatcmpl-test",
    model: "google/gemini-test",
  };
}

function toolCallChunk(): unknown {
  return chunk({
    tool_calls: [
      {
        function: { arguments: '{"path":"README.md"}', name: "read" },
        id: "call_1",
        index: 0,
        type: "function",
      },
    ],
  });
}

function runOpenAICompletionsStream(messages: AssistantMessage[] = []): Promise<AssistantMessage> {
  return streamOpenAICompletions(model(), normalizeContext({ messages, tools: [readTool] }), {
    apiKey: "test",
  }).result();
}

function getAssistantPayload(
  payload: unknown,
): { reasoning?: unknown; reasoning_details?: unknown } | undefined {
  const messages = (
    payload as {
      messages?: Array<{ role?: string; reasoning?: unknown; reasoning_details?: unknown }>;
    }
  ).messages;
  return messages?.find((message) => message.role === "assistant");
}

const openaiCompletionsReasoningDetailsSupport = {
  chunk,
  getAssistantPayload,
  model,
  readTool,
  reasoningDetail,
  runOpenAICompletionsStream,
  toolCallChunk,
};

export default openaiCompletionsReasoningDetailsSupport;
