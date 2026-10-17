import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { completeSimple, getEnvApiKey, streamSimple } from "../src/compat.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";

const provider = "xiaomi-token-plan-ams";
const apiKey = getEnvApiKey(provider);

const model: Model<"anthropic-messages"> = {
  id: "mimo-v2.6-pro",
  name: "MiMo-V2.6-Pro Anthropic smoke",
  api: "anthropic-messages",
  provider,
  baseUrl: "https://token-plan-ams.xiaomimimo.com/anthropic",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 3, cacheRead: 0.2, cacheWrite: 0 },
  contextWindow: 1048576,
  maxTokens: 1024,
  compat: { allowEmptySignature: true },
};

interface AnthropicPayload {
  messages?: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; thinking?: string; signature?: string }>;
  }>;
}

class PayloadCaptured extends Error {
  constructor() {
    super("payload captured");
    this.name = "PayloadCaptured";
  }
}

function makeInitialContext(): Context {
  return {
    systemPrompt: "You are concise. Follow the requested output format exactly.",
    messages: [
      {
        role: "user",
        content:
          "Think internally if you need to, then reply with exactly this text and nothing else: first-ok",
        timestamp: Date.now(),
      },
    ],
  };
}

function getThinkingBlocks(message: AssistantMessage) {
  return message.content.filter((block) => block.type === "thinking");
}

const captureReplayPayload = Effect.fn("captureReplayPayload")(function* (context: Context) {
  let capturedPayload: AnthropicPayload | undefined;
  const stream = streamSimple(model, context, {
    apiKey,
    maxTokens: 512,
    reasoning: "high",
    onPayload: (payload) => {
      capturedPayload = payload as AnthropicPayload;
      throw new PayloadCaptured();
    },
  });

  yield* Effect.promise(() => stream.result());

  if (capturedPayload === undefined) {
    throw new Error("Expected payload capture before request");
  }
  return capturedPayload;
});

describe.skipIf(apiKey === undefined || apiKey === "")(
  "Xiaomi Token Plan AMS Anthropic empty thinking signature smoke",
  () => {
    it(
      "reproduces empty thinking signatures and preserves them for replay",
      { timeout: 60000, retry: 1 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const firstContext = makeInitialContext();
            const first = yield* Effect.promise(() =>
              completeSimple(model, firstContext, {
                apiKey,
                maxTokens: 512,
                reasoning: "high",
              }),
            );

            expect(first.stopReason, first.errorMessage).toBe("stop");

            const thinkingBlocks = getThinkingBlocks(first);
            expect(thinkingBlocks.length).toBeGreaterThan(0);
            expect(thinkingBlocks.some((block) => block.thinkingSignature === "")).toBe(true);

            const replayContext: Context = {
              ...firstContext,
              messages: [
                ...firstContext.messages,
                first,
                {
                  role: "user",
                  content: "Reply with exactly this text and nothing else: second-ok",
                  timestamp: yield* Clock.currentTimeMillis,
                },
              ],
            };

            const replayPayload = yield* captureReplayPayload(replayContext);
            const assistantPayload = replayPayload.messages?.find(
              (message) => message.role === "assistant",
            );
            expect(assistantPayload).toBeDefined();
            expect(Array.isArray(assistantPayload!.content)).toBe(true);
            const replayedThinking = (
              assistantPayload!.content as Array<{ type: string; text?: string }>
            ).filter((block) => block.type === "thinking");
            const replayedText = (
              assistantPayload!.content as Array<{ type: string; text?: string }>
            ).filter((block) => block.type === "text");
            const firstThinking = thinkingBlocks.at(0)?.thinking;
            expect(replayedThinking).toEqual([
              { type: "thinking", thinking: firstThinking, signature: "" },
            ]);
            expect(replayedText.some((block) => block.text === firstThinking)).toBe(false);
          }),
        ),
    );
  },
);
