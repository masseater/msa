import { Data, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple } from "../src/compat.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

interface AnthropicPayload {
  messages?: Array<{
    role: string;
    content: Array<{ type: string; text?: string; thinking?: string; signature?: string }>;
  }>;
}

class PayloadCaptured extends Data.TaggedError("PayloadCaptured")<{ readonly message: string }> {}

function makeModel(allowEmptySignature?: boolean): Model<"anthropic-messages"> {
  return {
    id: "mimo-v2.6-pro",
    name: "MiMo-V2.6-Pro",
    api: "anthropic-messages",
    provider: "xiaomi-token-plan-ams",
    baseUrl: "http://127.0.0.1:9/anthropic",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 1024,
    ...(allowEmptySignature === undefined ? {} : { compat: { allowEmptySignature } }),
  };
}

function makeContext(
  thinkingSignature: string,
  thinking = "internal reasoning",
  provider = "xiaomi-token-plan-ams",
  model = "mimo-v2.6-pro",
): Context {
  const assistant: AssistantMessage = {
    role: "assistant",
    content: [{ type: "thinking", thinking, thinkingSignature }],
    provider,
    api: "anthropic-messages",
    model,
    timestamp: currentTimeMillis(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
  };
  return {
    messages: [
      { role: "user", content: "first", timestamp: currentTimeMillis() },
      assistant,
      { role: "user", content: "second", timestamp: currentTimeMillis() },
    ],
  };
}

const capturePayload = Effect.fn("capturePayload")(function* (
  model: Model<"anthropic-messages">,
  context: Context,
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
        expect(assistant?.content).toEqual([{ type: "text", text: "internal reasoning" }]);
      }),
    ));

  it("preserves empty thinking text when the signature is present", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel(), makeContext("signed-thinking", ""));
        const assistant = payload.messages?.find((message) => message.role === "assistant");
        expect(assistant?.content).toEqual([
          { type: "thinking", thinking: "", signature: "signed-thinking" },
        ]);
      }),
    ));

  it("preserves empty-signature thinking when allowEmptySignature is enabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel(true), makeContext(" "));
        const assistant = payload.messages?.find((message) => message.role === "assistant");
        expect(assistant?.content).toEqual([
          { type: "thinking", thinking: "internal reasoning", signature: "" },
        ]);
      }),
    ));
});
