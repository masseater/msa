import { writeFileSync } from "fs";

import { Console, DateTime, Effect } from "effect";
import { Type } from "typebox";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { completeSimple, getEnvApiKey, getModel } from "../src/compat.ts";
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  Tool,
  ToolResultMessage,
} from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { hasAzureOpenAICredentials } from "./azure-utils.ts";
import {
  hasCloudflareAiGatewayCredentials,
  hasCloudflareWorkersAICredentials,
} from "./cloudflare-utils.ts";
import { envValue, hasEnv, hasValue } from "./env.ts";
import { resolveApiKey } from "./oauth.ts";

const testToolSchema = Type.Object({
  value: Type.Number({ description: "A number to double" }),
});

const testTool: Tool<typeof testToolSchema> = {
  name: "double_number",
  description: "Doubles a number and returns the result",
  parameters: testToolSchema,
};

interface ProviderModelPair {
  provider: string;
  model: string;
  label: string;
  apiOverride?: Api;
  upstreamApiKeyEnv?: string;
}

const PROVIDER_MODEL_PAIRS: ProviderModelPair[] = [
  { provider: "anthropic", model: "claude-sonnet-4-5", label: "anthropic-claude-sonnet-4-5" },
  { provider: "google", model: "gemini-3-flash-preview", label: "google-gemini-3-flash-preview" },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    label: "openai-completions-gpt-4o-mini",
    apiOverride: "openai-completions",
  },
  { provider: "openai", model: "gpt-5-mini", label: "openai-responses-gpt-5-mini" },
  { provider: "azure", model: "gpt-4o-mini", label: "azure-gpt-4o-mini" },
  { provider: "openai-codex", model: "gpt-5.5", label: "openai-codex-gpt-5.5" },
  {
    provider: "amazon-bedrock",
    model: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    label: "bedrock-claude-sonnet-4-5",
  },
  { provider: "xai", model: "grok-4.3", label: "xai-grok-4.3" },
  { provider: "cerebras", model: "zai-glm-4.7", label: "cerebras-zai-glm-4.7" },
  {
    provider: "cloudflare-workers-ai",
    model: "@cf/moonshotai/kimi-k2.6",
    label: "cloudflare-kimi-k2.6",
  },
  {
    provider: "cloudflare-ai-gateway",
    model: "workers-ai/@cf/moonshotai/kimi-k2.6",
    label: "cloudflare-gateway-kimi-k2.6",
  },
  {
    provider: "cloudflare-ai-gateway",
    model: "claude-sonnet-4-5",
    label: "cloudflare-gateway-claude-sonnet-4-5",
    upstreamApiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    provider: "cloudflare-ai-gateway",
    model: "gpt-5.1",
    label: "cloudflare-gateway-gpt-5.1",
    upstreamApiKeyEnv: "OPENAI_API_KEY",
  },
  { provider: "groq", model: "openai/gpt-oss-120b", label: "groq-gpt-oss-120b" },
  { provider: "huggingface", model: "moonshotai/Kimi-K2.5", label: "huggingface-kimi-k2.5" },
  { provider: "together", model: "moonshotai/Kimi-K3", label: "together-kimi-k3" },
  { provider: "baseten", model: "zai-org/GLM-5.2", label: "baseten-glm-5.2" },
  { provider: "kimi-coding", model: "kimi-for-coding", label: "kimi-for-coding" },
  { provider: "meta", model: "muse-spark-1.3", label: "meta-muse-spark-1.3" },
  { provider: "mistral", model: "devstral-medium-latest", label: "mistral-devstral-medium" },
  { provider: "minimax", model: "MiniMax-M2.7", label: "minimax-m2.7" },
  { provider: "minimax-cn", model: "MiniMax-M2.7", label: "minimax-m2.7" },
  { provider: "opencode", model: "big-pickle", label: "zen-big-pickle" },
  { provider: "opencode", model: "claude-sonnet-4-5", label: "zen-claude-sonnet-4-5" },
  { provider: "opencode", model: "gemini-3-flash", label: "zen-gemini-3-flash" },
  { provider: "opencode", model: "glm-4.7-free", label: "zen-glm-4.7-free" },
  { provider: "opencode", model: "gpt-5.2-codex", label: "zen-gpt-5.2-codex" },
  { provider: "opencode", model: "minimax-m2.1-free", label: "zen-minimax-m2.1-free" },
  { provider: "opencode-go", model: "kimi-k2.5", label: "go-kimi-k2.5" },
  { provider: "opencode-go", model: "minimax-m2.5", label: "go-minimax-m2.5" },
  { provider: "xiaomi", model: "mimo-v2.6-pro", label: "xiaomi-mimo-v2.6-pro" },
  {
    provider: "xiaomi-token-plan-cn",
    model: "mimo-v2.6-pro",
    label: "xiaomi-token-plan-cn-mimo-v2.6-pro",
  },
  {
    provider: "xiaomi-token-plan-ams",
    model: "mimo-v2.6-pro",
    label: "xiaomi-token-plan-ams-mimo-v2.6-pro",
  },
  {
    provider: "xiaomi-token-plan-sgp",
    model: "mimo-v2.6-pro",
    label: "xiaomi-token-plan-sgp-mimo-v2.6-pro",
  },
  { provider: "qwen-token-plan", model: "qwen3.7-max", label: "qwen-token-plan-qwen3.7-max" },
  { provider: "qwen-token-plan-cn", model: "qwen3.7-max", label: "qwen-token-plan-cn-qwen3.7-max" },
  {
    provider: "qwen-token-plan-individual",
    model: "qwen3.8-max",
    label: "qwen-token-plan-individual-qwen3.8-max",
  },
  {
    provider: "qwen-token-plan-individual",
    model: "deepseek-v4-flash-0731",
    label: "qwen-token-plan-individual-deepseek-v4-flash-0731",
  },
  {
    provider: "qwen-token-plan-individual",
    model: "glm-5.2",
    label: "qwen-token-plan-individual-glm-5.2",
  },
];

interface CachedContext {
  label: string;
  provider: string;
  model: string;
  api: Api;
  messages: Message[];
  generatedAt: string;
}

function getApiKey(provider: string): Promise<string | undefined> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const oauthKey = yield* Effect.promise(() => resolveApiKey(provider));
      if (oauthKey !== undefined && oauthKey !== "") return oauthKey;
      return getEnvApiKey(provider);
    }),
  );
}

function hasApiKey(pair: ProviderModelPair): boolean {
  if (pair.provider === "azure") {
    return hasAzureOpenAICredentials();
  }
  if (pair.provider === "cloudflare-workers-ai") {
    return hasCloudflareWorkersAICredentials();
  }
  if (pair.provider === "cloudflare-ai-gateway") {
    if (!hasCloudflareAiGatewayCredentials()) return false;
    return pair.upstreamApiKeyEnv !== undefined && pair.upstreamApiKeyEnv !== ""
      ? hasEnv(pair.upstreamApiKeyEnv)
      : true;
  }
  return hasValue(getEnvApiKey(pair.provider));
}

function getHeaders(pair: ProviderModelPair): Record<string, string> | undefined {
  if (pair.upstreamApiKeyEnv === undefined || pair.upstreamApiKeyEnv === "") return undefined;
  const upstreamApiKey = envValue(pair.upstreamApiKeyEnv);
  return upstreamApiKey !== undefined && upstreamApiKey !== ""
    ? { Authorization: `Bearer ${upstreamApiKey}` }
    : undefined;
}

function hasAnyApiKey(): boolean {
  return PROVIDER_MODEL_PAIRS.some((pair) => hasApiKey(pair));
}

function dumpFailurePayload(params: {
  label: string;
  error: string;
  payload?: unknown;
  messages: Message[];
}): void {
  const filename = `/tmp/msa-handoff-${params.label}-${currentTimeMillis()}.json`;
  const body = {
    label: params.label,
    error: params.error,
    payload: params.payload,
    messages: params.messages,
  };
  writeFileSync(filename, JSON.stringify(body, null, 2));
  console.log(`Wrote failure payload to ${filename}`);
}

async function generateContext(
  pair: ProviderModelPair,
  apiKey: string,
): Promise<{ messages: Message[]; api: Api } | null> {
  const baseModel = (getModel as (p: string, m: string) => Model<Api> | undefined)(
    pair.provider,
    pair.model,
  );
  if (baseModel === undefined) {
    console.log(`  Model not found: ${pair.provider}/${pair.model}`);
    return null;
  }

  const model: Model<Api> =
    pair.apiOverride === undefined ? baseModel : { ...baseModel, api: pair.apiOverride };

  const userMessage: Message = {
    role: "user",
    content: "Please double the number 21 using the double_number tool.",
    timestamp: currentTimeMillis(),
  };

  const supportsReasoning = model.reasoning === true;
  const headers = getHeaders(pair);
  let lastPayload: unknown;
  let assistantResponse: AssistantMessage;
  try {
    assistantResponse = await completeSimple(
      model,
      {
        systemPrompt: "You are a helpful assistant. Use the provided tool to complete the task.",
        messages: [userMessage],
        tools: [testTool],
      },
      {
        apiKey,
        reasoning: supportsReasoning ? "high" : undefined,
        headers,
        onPayload: (payload) => {
          lastPayload = payload;
        },
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Initial request failed: ${msg}`);
    dumpFailurePayload({
      label: `${pair.label}-initial`,
      error: msg,
      payload: lastPayload,
      messages: [userMessage],
    });
    return null;
  }

  if (assistantResponse.stopReason === "error") {
    console.log(`  Initial request error: ${assistantResponse.errorMessage}`);
    dumpFailurePayload({
      label: `${pair.label}-initial`,
      error: assistantResponse.errorMessage || "Unknown error",
      payload: lastPayload,
      messages: [userMessage],
    });
    return null;
  }

  const toolCall = assistantResponse.content.find((c) => c.type === "toolCall");
  if (toolCall === undefined || toolCall.type !== "toolCall") {
    console.log(`  No tool call in response (stopReason: ${assistantResponse.stopReason})`);
    return {
      messages: [userMessage, assistantResponse],
      api: model.api,
    };
  }

  console.log(`  Tool call ID: ${toolCall.id}`);

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: "42" }],
    isError: false,
    timestamp: currentTimeMillis(),
  };

  let finalResponse: AssistantMessage;
  const messagesForFinal = [userMessage, assistantResponse, toolResult];
  try {
    finalResponse = await completeSimple(
      model,
      {
        systemPrompt: "You are a helpful assistant.",
        messages: messagesForFinal,
        tools: [testTool],
      },
      {
        apiKey,
        reasoning: supportsReasoning ? "high" : undefined,
        headers,
        onPayload: (payload) => {
          lastPayload = payload;
        },
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Final request failed: ${msg}`);
    dumpFailurePayload({
      label: `${pair.label}-final`,
      error: msg,
      payload: lastPayload,
      messages: messagesForFinal,
    });
    return null;
  }

  if (finalResponse.stopReason === "error") {
    console.log(`  Final request error: ${finalResponse.errorMessage}`);
    dumpFailurePayload({
      label: `${pair.label}-final`,
      error: finalResponse.errorMessage || "Unknown error",
      payload: lastPayload,
      messages: messagesForFinal,
    });
    return null;
  }

  return {
    messages: [userMessage, assistantResponse, toolResult, finalResponse],
    api: model.api,
  };
}

describe.skipIf(!hasAnyApiKey())("Cross-Provider Handoff", () => {
  let contexts: Record<string, CachedContext>;
  let availablePairs: ProviderModelPair[];
  beforeAll(
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          contexts = {};
          availablePairs = [];

          yield* Console.log("\n=== Generating Fixtures ===\n");

          for (const pair of PROVIDER_MODEL_PAIRS) {
            const apiKey = yield* Effect.promise(() => getApiKey(pair.provider));
            if (apiKey === undefined || apiKey === "" || !hasApiKey(pair)) {
              yield* Console.log(`[${pair.label}] Skipping - no auth for ${pair.provider}`);
              continue;
            }

            yield* Console.log(`[${pair.label}] Generating fixture...`);
            const result = yield* Effect.promise(() => generateContext(pair, apiKey));

            if (result === null || result.messages.length < 4) {
              yield* Console.log(`[${pair.label}] Failed to generate fixture, skipping`);
              continue;
            }

            contexts[pair.label] = {
              label: pair.label,
              provider: pair.provider,
              model: pair.model,
              api: result.api,
              messages: result.messages,
              generatedAt: DateTime.formatIso(yield* DateTime.now),
            };
            availablePairs.push(pair);
            yield* Console.log(`[${pair.label}] Generated ${result.messages.length} messages`);
          }

          yield* Console.log(
            `\n=== ${availablePairs.length}/${PROVIDER_MODEL_PAIRS.length} contexts available ===\n`,
          );
        }),
      ),
    300000,
  );
  it.skipIf(!hasAnyApiKey())("should have at least 2 fixtures to test handoffs", () => {
    expect(Object.keys(contexts).length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!hasAnyApiKey())("Cross-Provider Handoff", () => {
  let contexts: Record<string, CachedContext>;
  let availablePairs: ProviderModelPair[];
  beforeAll(
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          contexts = {};
          availablePairs = [];

          yield* Console.log("\n=== Generating Fixtures ===\n");

          for (const pair of PROVIDER_MODEL_PAIRS) {
            const apiKey = yield* Effect.promise(() => getApiKey(pair.provider));
            if (apiKey === undefined || apiKey === "" || !hasApiKey(pair)) {
              yield* Console.log(`[${pair.label}] Skipping - no auth for ${pair.provider}`);
              continue;
            }

            yield* Console.log(`[${pair.label}] Generating fixture...`);
            const result = yield* Effect.promise(() => generateContext(pair, apiKey));

            if (result === null || result.messages.length < 4) {
              yield* Console.log(`[${pair.label}] Failed to generate fixture, skipping`);
              continue;
            }

            contexts[pair.label] = {
              label: pair.label,
              provider: pair.provider,
              model: pair.model,
              api: result.api,
              messages: result.messages,
              generatedAt: DateTime.formatIso(yield* DateTime.now),
            };
            availablePairs.push(pair);
            yield* Console.log(`[${pair.label}] Generated ${result.messages.length} messages`);
          }

          yield* Console.log(
            `\n=== ${availablePairs.length}/${PROVIDER_MODEL_PAIRS.length} contexts available ===\n`,
          );
        }),
      ),
    300000,
  );
  it.skipIf(!hasAnyApiKey())(
    "should handle cross-provider handoffs for each target",
    async () => {
      const contextLabels = Object.keys(contexts);

      if (contextLabels.length < 2) {
        console.log("Not enough fixtures for handoff test, skipping");
        return;
      }

      console.log("\n=== Testing Cross-Provider Handoffs ===\n");

      const results: { target: string; success: boolean; error?: string | undefined }[] = [];

      for (const targetPair of availablePairs) {
        const apiKey = await getApiKey(targetPair.provider);
        if (apiKey === undefined || apiKey === "" || !hasApiKey(targetPair)) {
          console.log(`[Target: ${targetPair.label}] Skipping - no auth`);
          continue;
        }

        const otherMessages: Message[] = [];
        for (const [label, ctx] of Object.entries(contexts)) {
          if (label === targetPair.label) continue;
          otherMessages.push(...ctx.messages);
        }

        if (otherMessages.length === 0) {
          console.log(`[Target: ${targetPair.label}] Skipping - no other contexts`);
          continue;
        }

        const allMessages: Message[] = [
          ...otherMessages,
          {
            role: "user",
            content:
              "Great, thanks for all that help! Now just say 'Hello, handoff successful!' to confirm you received everything.",
            timestamp: currentTimeMillis(),
          },
        ];

        const baseModel = (getModel as (p: string, m: string) => Model<Api> | undefined)(
          targetPair.provider,
          targetPair.model,
        );
        if (baseModel === undefined) {
          console.log(`[Target: ${targetPair.label}] Model not found`);
          continue;
        }

        const model: Model<Api> =
          targetPair.apiOverride === undefined
            ? baseModel
            : { ...baseModel, api: targetPair.apiOverride };
        const supportsReasoning = model.reasoning === true;
        const headers = getHeaders(targetPair);

        console.log(
          `[Target: ${targetPair.label}] Testing with ${otherMessages.length} messages from other providers...`,
        );

        let lastPayload: unknown;
        try {
          const response = await completeSimple(
            model,
            {
              systemPrompt: "You are a helpful assistant.",
              messages: allMessages,
              tools: [testTool],
            },
            {
              apiKey,
              reasoning: supportsReasoning ? "high" : undefined,
              headers,
              onPayload: (payload) => {
                lastPayload = payload;
              },
            },
          );

          if (response.stopReason === "error") {
            console.log(`[Target: ${targetPair.label}] FAILED: ${response.errorMessage}`);
            dumpFailurePayload({
              label: targetPair.label,
              error: response.errorMessage || "Unknown error",
              payload: lastPayload,
              messages: allMessages,
            });
            results.push({
              target: targetPair.label,
              success: false,
              error: response.errorMessage,
            });
          } else {
            const text = response.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join(" ");
            const preview = text.slice(0, 100).replace(/\n/gu, " ");
            console.log(`[Target: ${targetPair.label}] SUCCESS: ${preview}...`);
            results.push({ target: targetPair.label, success: true });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.log(`[Target: ${targetPair.label}] EXCEPTION: ${msg}`);
          dumpFailurePayload({
            label: targetPair.label,
            error: msg,
            payload: lastPayload,
            messages: allMessages,
          });
          results.push({ target: targetPair.label, success: false, error: msg });
        }
      }

      console.log("\n=== Results Summary ===\n");
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      console.log(`Passed: ${successes.length}/${results.length}`);
      if (failures.length > 0) {
        console.log("\nFailures:");
        for (const f of failures) {
          console.log(`  - ${f.target}: ${f.error}`);
        }
      }

      expect(failures.length).toBe(0);
    },
    600000,
  );
});
