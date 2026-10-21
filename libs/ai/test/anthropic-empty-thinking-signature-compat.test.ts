import { Data, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";

const { currentTimeMillis } = clock;
const { streamSimple } = compatModule;

interface AnthropicPayload {
  messages?: Array<{
    role: string;
    content: Array<{ type: string; text?: string; thinking?: string; signature?: string }>;
  }>;
}

class PayloadCaptured extends Data.TaggedError("PayloadCaptured")<{ readonly message: string }> {}

function makeModel(allowEmptySignature?: boolean): typesModule.Model<"anthropic-messages"> {
  return {
    api: "anthropic-messages",
    baseUrl: "http://127.0.0.1:9/anthropic",
    contextWindow: 1048576,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "mimo-v2.6-pro",
    input: ["text"],
    maxTokens: 1024,
    name: "MiMo-V2.6-Pro",
    provider: "xiaomi-token-plan-ams",
    reasoning: true,
    ...(allowEmptySignature === undefined ? {} : { compat: { allowEmptySignature } }),
  };
}

function makeContext(
  thinkingSignature: string,
  thinking = "internal reasoning",
  provider = "xiaomi-token-plan-ams",
  model = "mimo-v2.6-pro",
): typesModule.Context {
  const assistant: typesModule.AssistantMessage = {
    api: "anthropic-messages",
    content: [{ thinking, thinkingSignature, type: "thinking" }],
    model,
    provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
  return {
    messages: [
      { content: "first", role: "user", timestamp: currentTimeMillis() },
      assistant,
      { content: "second", role: "user", timestamp: currentTimeMillis() },
    ],
  };
}

const capturePayload = Effect.fn("capturePayload")(function* (
  model: typesModule.Model<"anthropic-messages">,
  context: typesModule.Context,
) {
  let capturedPayload: AnthropicPayload | undefined;
  const stream = streamSimple(model, context, {
    apiKey: "fake-key",
    onPayload: (payload) => {
      capturedPayload = payload as AnthropicPayload;
      throw new PayloadCaptured({ message: "payload captured" });
    },
  });
  yield* Effect.promise(() => stream.result());
  if (capturedPayload === undefined) throw new Error("Expected payload capture before request");
  return capturedPayload;
});

describe("Anthropic empty thinking signature compat", () => {
  it("converts empty-signature thinking to text by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel(), makeContext(""));
        const assistant = payload.messages?.find((message) => message.role === "assistant");
        expect(assistant?.content).toEqual([{ text: "internal reasoning", type: "text" }]);
      }),
    ));

  it("preserves empty thinking text when the signature is present", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel(), makeContext("signed-thinking", ""));
        const assistant = payload.messages?.find((message) => message.role === "assistant");
        expect(assistant?.content).toEqual([
          { signature: "signed-thinking", thinking: "", type: "thinking" },
        ]);
      }),
    ));

  it("preserves empty-signature thinking when allowEmptySignature is enabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel(true), makeContext(" "));
        const assistant = payload.messages?.find((message) => message.role === "assistant");
        expect(assistant?.content).toEqual([
          { signature: "", thinking: "internal reasoning", type: "thinking" },
        ]);
      }),
    ));
});
