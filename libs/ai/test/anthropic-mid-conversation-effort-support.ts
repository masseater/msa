import { Effect } from "effect";

import { type AnthropicOptions, stream } from "../src/api/anthropic-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import type { Context, Model } from "../src/types.ts";

interface WireMessage {
  role: string;
  content: unknown;
  output_config?: { effort?: string };
}

interface CapturedPayload {
  messages: WireMessage[];
  thinking?: {
    type: string;
    display?: string;
    block_binding?: { prefix_mismatch_behavior?: string };
  };
  output_config?: { effort?: string };
  fallbacks?: Array<{ model: string }>;
}

function managedModel(provider = "anthropic-api"): Model<"anthropic-messages"> {
  return {
    api: "anthropic-messages",
    baseUrl: "http://127.0.0.1:9",
    compat: { forceAdaptiveThinking: true, supportsMidConvoEffort: true },
    contextWindow: 200000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "claude-fable-5-1",
    input: ["text"],
    maxTokens: 32000,
    name: "Claude Fable 5.1",
    provider,
    reasoning: true,
    thinkingLevelMap: {
      high: "high",
      low: "low",
      max: "max",
      medium: "medium",
      minimal: "low",
      off: null,
    },
  };
}

const capture = Effect.fn("capture")(function* (
  model: Model<"anthropic-messages">,
  context: Context,
  options: Pick<AnthropicOptions, "effort" | "thinkingEnabled"> = {},
) {
  let payload: CapturedPayload | undefined;
  const result = stream(model, normalizeContext(context), {
    apiKey: "test-key",
    cacheRetention: "none",
    thinkingEnabled: true,
    ...options,
    onPayload: (value) => {
      payload = value as CapturedPayload;
      throw new Error("payload captured");
    },
  });
  const message = yield* Effect.promise(() => result.result());
  if (payload === undefined) throw new Error("Expected payload capture");
  return { message, payload };
});

const user = (text: string, timestamp: number) => ({
  content: text,
  role: "user" as const,
  timestamp,
});

const anthropicMidConversationEffortSupport = {
  capture,
  managedModel,
  user,
};

export default anthropicMidConversationEffortSupport;
