import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getCompat } from "../src/api/openai-completions-compat.ts";
import {
  convertMessages,
  stream as streamOpenAICompletions,
} from "../src/api/openai-completions.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import jsonCodec from "./json-codec.ts";

const { decodeJson, encodeJson } = jsonCodec;

const model: Model<"openai-completions"> = {
  api: "openai-completions",
  baseUrl: "https://completions.test/v1",
  compat: { requiresThinkingAsText: true },
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "repro-model",
  input: ["text"],
  maxTokens: 4096,
  name: "Repro Model",
  provider: "repro-provider",
  reasoning: true,
};

const replayContext = (content: AssistantMessage["content"]): Context => ({
  messages: [
    { content: "hello", role: "user", timestamp: 1 },
    {
      api: model.api,
      content,
      model: model.id,
      provider: model.provider,
      role: "assistant",
      stopReason: "stop",
      timestamp: 2,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    { content: "continue", role: "user", timestamp: 3 },
  ],
});

const thinkingAndText: AssistantMessage["content"] = [
  { thinking: "internal reasoning", type: "thinking" },
  { text: "visible answer", type: "text" },
];

const replayedAssistant = (content: AssistantMessage["content"]) =>
  convertMessages(model, normalizeContext(replayContext(content)), getCompat(model))[1];

const completionStream = Effect.gen(function* () {
  const chunk = (fields: object) =>
    encodeJson({
      created: 0,
      id: "chatcmpl-repro",
      model: "repro-model",
      object: "chat.completion.chunk",
      ...fields,
    });
  const lines = [
    yield* chunk({
      choices: [{ delta: { content: "ok", role: "assistant" }, finish_reason: null, index: 0 }],
    }),
    yield* chunk({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      usage: { completion_tokens: 1, prompt_tokens: 1 },
    }),
    "[DONE]",
  ];
  return lines.map((line) => `data: ${line}\n\n`).join("");
});

const reachesEndpointWithThinkingAndText = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const body = yield* completionStream;
      const sent: string[] = [];
      const result = yield* Effect.promise(() =>
        streamOpenAICompletions(model, normalizeContext(replayContext(thinkingAndText)), {
          apiKey: "test-key",
          fetch: (_input, init) => {
            sent.push(String(init?.body));
            return Promise.resolve(
              new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 }),
            );
          },
        }).result(),
      );
      expect(sent).toHaveLength(1);
      const request = (yield* decodeJson(sent[0] ?? "")) as { messages: unknown[] };
      expect(request.messages[1]).toEqual({
        content: [
          { text: "internal reasoning", type: "text" },
          { text: "visible answer", type: "text" },
        ],
        role: "assistant",
      });
      expect(result.stopReason).toBe("stop");
    }),
  );

describe("openai-completions thinking-as-text replay", () => {
  it("serializes same-model thinking-plus-text replay as assistant text parts", () => {
    expect(replayedAssistant(thinkingAndText)).toEqual({
      content: [
        { text: "internal reasoning", type: "text" },
        { text: "visible answer", type: "text" },
      ],
      role: "assistant",
    });
  });
  it("serializes same-model thinking-only replay as assistant text parts", () => {
    expect(replayedAssistant([{ thinking: "internal reasoning", type: "thinking" }])).toEqual({
      content: [{ text: "internal reasoning", type: "text" }],
      role: "assistant",
    });
  });
  it(
    "reaches the endpoint when replay contains both thinking and text",
    reachesEndpointWithThinkingAndText,
  );
});
