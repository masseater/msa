import { describe, expect, it } from "vite-plus/test";

import { completeSimple, getModel } from "../src/compat.ts";
import { getEnvApiKey } from "../src/env-api-keys.ts";
import type {
  Api,
  AssistantMessage,
  Context,
  Message,
  Model,
  Tool,
  ToolResultMessage,
} from "../src/types.ts";
import { resolveApiKey } from "./oauth.ts";

const radiusKey = process.env["RADIUS_API_KEY"] ?? (await resolveApiKey("radius"));
const anthropicKey = getEnvApiKey("anthropic") ?? (await resolveApiKey("anthropic"));

const tool: Tool = {
  name: "lookup",
  description: "Look up a value by key.",
  parameters: {
    type: "object",
    properties: { key: { type: "string" } },
    required: ["key"],
  } as unknown as Tool["parameters"],
};

const user: Message = {
  role: "user",
  content:
    "First, think carefully: list every prime between 100 and 300 in your head and sum them. " +
    "Then call the lookup tool with key equal to that sum. Do not write the primes in your visible reply.",
  timestamp: 1,
};

function inputTokens(message: AssistantMessage): number {
  return message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
}

function request<TApi extends Api>(
  model: Model<TApi>,
  apiKey: string,
  messages: Message[],
): Promise<AssistantMessage> {
  const context: Context = {
    systemPrompt: "You are a careful assistant.",
    messages,
    tools: [tool],
  };
  return completeSimple(model, context, {
    apiKey,
    reasoning: "high",
    maxTokens: 16000,
    cacheRetention: "none",
  });
}

async function thinkingTurn<TApi extends Api>(
  model: Model<TApi>,
  apiKey: string,
): Promise<{ reply: AssistantMessage; result: ToolResultMessage }> {
  const reply = await request(model, apiKey, [user]);
  expect(reply.stopReason, reply.errorMessage).toBe("toolUse");
  expect(
    reply.content.some(
      (block) => block.type === "thinking" && (block.thinkingSignature ?? "").length > 0,
    ),
  ).toBe(true);
  const call = reply.content.find((block) => block.type === "toolCall");
  if (call?.type !== "toolCall") throw new Error("reply has no tool call");
  const result: ToolResultMessage = {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text: "value: 42" }],
    isError: false,
    timestamp: 2,
  };
  return { reply, result };
}

async function replayedThinkingTokens<TApi extends Api>(
  model: Model<TApi>,
  apiKey: string,
  reply: AssistantMessage,
  result: ToolResultMessage,
): Promise<number> {
  const withoutThinking: AssistantMessage = {
    ...reply,
    content: reply.content.filter((block) => block.type !== "thinking"),
  };
  const [kept, stripped] = await Promise.all([
    request(model, apiKey, [user, reply, result]),
    request(model, apiKey, [user, withoutThinking, result]),
  ]);
  expect(kept.stopReason, kept.errorMessage).not.toBe("error");
  expect(stripped.stopReason, stripped.errorMessage).not.toBe("error");
  return inputTokens(kept) - inputTokens(stripped);
}

describe("replayed Claude thinking stays in context", () => {
  it.skipIf(anthropicKey === undefined || anthropicKey === "")(
    "anthropic keeps it (control)",
    { timeout: 180000 },
    async () => {
      const model = getModel("anthropic", "claude-opus-5-5");
      const { reply, result } = await thinkingTurn(model, anthropicKey!);
      expect(reply.providerThinkingLevel).toBe("high");
      const added = await replayedThinkingTokens(model, anthropicKey!, reply, result);
      expect(added).toBeGreaterThan(0.5 * reply.usage.output);
    },
  );

  it.skipIf(radiusKey === undefined || radiusKey === "")(
    "radius keeps it",
    { timeout: 180000 },
    async () => {
      const model = getModel("radius", "claude-opus-5-5");
      const { reply, result } = await thinkingTurn(model, radiusKey!);
      expect
        .soft(reply.providerThinkingLevel, "radius done event omits providerThinkingLevel")
        .toBe("high");
      const added = await replayedThinkingTokens(model, radiusKey!, reply, result);
      expect(added, "radius dropped the replayed thinking").toBeGreaterThan(
        0.5 * reply.usage.output,
      );
    },
  );

  it.skipIf(radiusKey === undefined || radiusKey === "")(
    "radius keeps it when the client supplies the level",
    { timeout: 180000 },
    async () => {
      const model = getModel("radius", "claude-opus-5-5");
      const { reply, result } = await thinkingTurn(model, radiusKey!);
      const added = await replayedThinkingTokens(
        model,
        radiusKey!,
        { ...reply, providerThinkingLevel: "high" },
        result,
      );
      expect(added).toBeGreaterThan(0.5 * reply.usage.output);
    },
  );
});
