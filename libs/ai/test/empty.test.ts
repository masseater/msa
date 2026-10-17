import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
  UserMessage,
} from "../src/types.ts";
import { envValue } from "./env.ts";

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

const testEmptyMessage = Effect.fn("testEmptyMessage")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const emptyMessage: UserMessage = {
    role: "user",
    content: [],
    timestamp: yield* Clock.currentTimeMillis,
  };

  const context: Context = {
    messages: [emptyMessage],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");
  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
  }
});

const testEmptyStringMessage = Effect.fn("testEmptyStringMessage")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: Context = {
    messages: [
      {
        role: "user",
        content: "",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");

  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
  }
});

const testWhitespaceOnlyMessage = Effect.fn("testWhitespaceOnlyMessage")(function* <
  TApi extends Api,
>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const context: Context = {
    messages: [
      {
        role: "user",
        content: "   \n\t  ",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");

  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
  }
});

const testEmptyAssistantMessage = Effect.fn("testEmptyAssistantMessage")(function* <
  TApi extends Api,
>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const emptyAssistant: AssistantMessage = {
    role: "assistant",
    content: [],
    api: llm.api,
    provider: llm.provider,
    model: llm.id,
    usage: {
      input: 10,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: yield* Clock.currentTimeMillis,
  };

  const context: Context = {
    messages: [
      {
        role: "user",
        content: "Hello, how are you?",
        timestamp: yield* Clock.currentTimeMillis,
      },
      emptyAssistant,
      {
        role: "user",
        content: "Please respond this time.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");

  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
  }
});

describe("AI Providers Empty Message Tests", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google Provider Empty Messages",
    () => {
      const llm = getModel("google", "gemini-2.5-flash");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider Empty Messages",
    () => {
      const llm = getModel("openai", "gpt-4o-mini");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider Empty Messages",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(!hasAzureOpenAICredentials())(
    "Azure OpenAI Responses Provider Empty Messages",
    () => {
      const llm = getModel("azure", "gpt-4o-mini");
      const azureDeploymentName = resolveAzureDeploymentName(llm.id);
      const azureOptions =
        azureDeploymentName !== undefined && azureDeploymentName !== ""
          ? { azureDeploymentName }
          : {};

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm, azureOptions)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm, azureOptions)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm, azureOptions)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm, azureOptions)),
      );
    },
  );

  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider Empty Messages", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(envValue("XAI_API_KEY") === undefined || envValue("XAI_API_KEY") === "")(
    "xAI Provider Empty Messages",
    () => {
      const llm = getModel("xai", "grok-4.3");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(envValue("GROQ_API_KEY") === undefined || envValue("GROQ_API_KEY") === "")(
    "Groq Provider Empty Messages",
    () => {
      const llm = getModel("groq", "openai/gpt-oss-20b");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("CEREBRAS_API_KEY") === undefined || envValue("CEREBRAS_API_KEY") === "",
  )("Cerebras Provider Empty Messages", () => {
    const llm = getModel("cerebras", "gpt-oss-120b");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(!hasCloudflareWorkersAICredentials())(
    "Cloudflare Workers AI Provider Empty Messages",
    () => {
      const llm = getModel("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(!hasCloudflareAiGatewayCredentials())(
    "Cloudflare AI Gateway Provider Empty Messages",
    () => {
      const llm = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(envValue("HF_TOKEN") === undefined || envValue("HF_TOKEN") === "")(
    "Hugging Face Provider Empty Messages",
    () => {
      const llm = getModel("huggingface", "moonshotai/Kimi-K2.5");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI Provider Empty Messages", () => {
    const llm = getModel("together", "moonshotai/Kimi-K3");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten Provider Empty Messages",
    () => {
      const llm = getModel("baseten", "zai-org/GLM-5.2");
      const options = { reasoningEffort: "high" } satisfies StreamOptionsWithExtras;

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm, options)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm, options)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm, options)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm, options)),
      );
    },
  );

  describe.skipIf(envValue("ZAI_API_KEY") === undefined || envValue("ZAI_API_KEY") === "")(
    "zAI Provider Empty Messages",
    () => {
      const llm = getModel("zai", "glm-5.2");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider Empty Messages",
    () => {
      const llm = getModel("mistral", "devstral-medium-latest");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax Provider Empty Messages",
    () => {
      const llm = getModel("minimax", "MiniMax-M2.7");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing) Provider Empty Messages",
    () => {
      const llm = getModel("xiaomi", "mimo-v2.6-pro");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN) Provider Empty Messages", () => {
    const llm = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS) Provider Empty Messages", () => {
    const llm = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP) Provider Empty Messages", () => {
    const llm = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Provider Empty Messages", () => {
    const llm = getModel("qwen-token-plan", "qwen3.7-max");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual Provider Empty Messages", () => {
    const llm = getModel("qwen-token-plan-individual", "qwen3.8-max");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN) Provider Empty Messages", () => {
    const llm = getModel("qwen-token-plan-cn", "qwen3.7-max");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding Provider Empty Messages",
    () => {
      const llm = getModel("kimi-coding", "kimi-for-coding");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider Empty Messages", () => {
    const llm = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock Provider Empty Messages", () => {
    const llm = getModel("amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });

  describe("Anthropic OAuth Provider Empty Messages", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle empty content array",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testEmptyMessage(llm, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle empty string content",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testEmptyStringMessage(llm, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle whitespace-only content",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testWhitespaceOnlyMessage(llm, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle empty assistant message in conversation",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testEmptyAssistantMessage(llm, { apiKey: anthropicOAuthToken })),
    );
  });

  describe("OpenAI Codex Provider Empty Messages", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty content array",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testEmptyMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty string content",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testEmptyStringMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle whitespace-only content",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testWhitespaceOnlyMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty assistant message in conversation",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testEmptyAssistantMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
