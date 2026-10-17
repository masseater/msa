import { Clock, Console, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions, Tool } from "../src/types.ts";
import { envValue } from "./env.ts";
import { encodeJsonPretty } from "./json-codec.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { hasBedrockCredentials } from "./bedrock-utils.ts";
import {
  hasCloudflareAiGatewayCredentials,
  hasCloudflareWorkersAICredentials,
} from "./cloudflare-utils.ts";
import { resolveApiKey } from "./oauth.ts";

const oauthTokens = await Promise.all([resolveApiKey("anthropic"), resolveApiKey("openai-codex")]);
const [anthropicOAuthToken, openaiCodexToken] = oauthTokens;

const calculateSchema = Type.Object({
  expression: Type.String({ description: "The mathematical expression to evaluate" }),
});

const calculateTool: Tool = {
  name: "calculate",
  description: "Evaluate mathematical expressions",
  parameters: calculateSchema,
};

const testToolCallWithoutResult = Effect.fn("testToolCallWithoutResult")(function* <
  TApi extends Api,
>(model: Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const context: Context = {
    systemPrompt:
      "You are a helpful assistant. Use the calculate tool when asked to perform calculations.",
    messages: [],
    tools: [calculateTool],
  };

  context.messages.push({
    role: "user",
    content: "Please calculate 25 * 18 using the calculate tool.",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const firstResponse = yield* Effect.promise(() => complete(model, context, options));
  context.messages.push(firstResponse);

  yield* Console.log("First response:", yield* encodeJsonPretty(firstResponse));

  const hasToolCall = firstResponse.content.some((block) => block.type === "toolCall");
  expect(hasToolCall).toBe(true);

  if (!hasToolCall) {
    throw new Error("Expected assistant to make a tool call, but none was found");
  }

  context.messages.push({
    role: "user",
    content: "Never mind, just tell me what is 2+2?",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const secondResponse = yield* Effect.promise(() => complete(model, context, options));
  yield* Console.log("Second response:", yield* encodeJsonPretty(secondResponse));

  expect(secondResponse.stopReason).not.toBe("error");

  expect(secondResponse.content.length).toBeGreaterThan(0);

  const textContent = secondResponse.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ");
  const toolCalls = secondResponse.content.filter((block) => block.type === "toolCall").length;
  expect(toolCalls || textContent.length).toBeGreaterThan(0);
  yield* Console.log("Answer:", textContent);

  expect(["stop", "toolUse"]).toContain(secondResponse.stopReason);
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google Provider",
    () => {
      const model = getModel("google", "gemini-2.5-flash");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider",
    () => {
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
      void _compat;
      const model: Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider",
    () => {
      const model = getModel("openai", "gpt-5-mini");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses Provider", () => {
    const model = getModel("azure", "gpt-4o-mini");
    const azureDeploymentName = resolveAzureDeploymentName(model.id);
    const azureOptions =
      azureDeploymentName !== undefined && azureDeploymentName !== ""
        ? { azureDeploymentName }
        : {};

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model, azureOptions)),
    );
  });

  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider", () => {
    const model = getModel("anthropic", "claude-haiku-4-5");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(envValue("XAI_API_KEY") === undefined || envValue("XAI_API_KEY") === "")(
    "xAI Provider",
    () => {
      const model = getModel("xai", "grok-4.3");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(envValue("GROQ_API_KEY") === undefined || envValue("GROQ_API_KEY") === "")(
    "Groq Provider",
    () => {
      const model = getModel("groq", "openai/gpt-oss-20b");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(
    envValue("CEREBRAS_API_KEY") === undefined || envValue("CEREBRAS_API_KEY") === "",
  )("Cerebras Provider", () => {
    const model = getModel("cerebras", "gpt-oss-120b");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(!hasCloudflareWorkersAICredentials())("Cloudflare Workers AI Provider", () => {
    const model = getModel("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(!hasCloudflareAiGatewayCredentials())("Cloudflare AI Gateway Provider", () => {
    const model = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(envValue("HF_TOKEN") === undefined || envValue("HF_TOKEN") === "")(
    "Hugging Face Provider",
    () => {
      const model = getModel("huggingface", "moonshotai/Kimi-K2.5");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI Provider", () => {
    const model = getModel("together", "moonshotai/Kimi-K3");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model, { reasoningEffort: "high" })),
    );
  });

  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten Provider",
    () => {
      const model = getModel("baseten", "zai-org/GLM-5.2");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model, { reasoningEffort: "high" })),
      );
    },
  );

  describe.skipIf(envValue("ZAI_API_KEY") === undefined || envValue("ZAI_API_KEY") === "")(
    "zAI Provider",
    () => {
      const model = getModel("zai", "glm-5.2");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider",
    () => {
      const model = getModel("mistral", "devstral-medium-latest");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax Provider",
    () => {
      const model = getModel("minimax", "MiniMax-M2.7");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing) Provider",
    () => {
      const model = getModel("xiaomi", "mimo-v2.6-pro");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN) Provider", () => {
    const model = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS) Provider", () => {
    const model = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP) Provider", () => {
    const model = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Provider", () => {
    const model = getModel("qwen-token-plan", "qwen3.7-max");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual Provider", () => {
    const model = getModel("qwen-token-plan-individual", "qwen3.8-max");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN) Provider", () => {
    const model = getModel("qwen-token-plan-cn", "qwen3.7-max");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding Provider",
    () => {
      const model = getModel("kimi-coding", "kimi-for-coding");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider", () => {
    const model = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });

  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock Provider", () => {
    const model = getModel("amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });
});

describe("Tool Call Without Result Tests", () => {
  describe("Anthropic OAuth Provider", () => {
    const model = getModel("anthropic", "claude-haiku-4-5");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model, { apiKey: anthropicOAuthToken })),
    );
  });

  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openai-codex", "gpt-5.5");
            yield* testToolCallWithoutResult(model, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
