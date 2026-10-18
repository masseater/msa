import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions, ToolResultMessage } from "../src/types.ts";
import { envValue } from "./env.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { currentTimeMillis } from "../src/utils/clock.ts";
import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { hasBedrockCredentials } from "./bedrock-utils.ts";
import {
  hasCloudflareAiGatewayCredentials,
  hasCloudflareWorkersAICredentials,
} from "./cloudflare-utils.ts";
import { resolveApiKey } from "./oauth.ts";

const emptySchema = Type.Object({});

const oauthTokens = await Promise.all([resolveApiKey("anthropic"), resolveApiKey("openai-codex")]);
const [anthropicOAuthToken, openaiCodexToken] = oauthTokens;

async function testEmojiInToolResults<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const toolCallId = llm.provider === "mistral" ? "testtool1" : "test_1";
  const context: Context = {
    systemPrompt: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Use the test tool",
        timestamp: currentTimeMillis(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "test_tool",
            arguments: {},
          },
        ],
        api: llm.api,
        provider: llm.provider,
        model: llm.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
      },
    ],
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        parameters: emptySchema,
      },
    ],
  };

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCallId,
    toolName: "test_tool",
    content: [
      {
        type: "text",
        text: `Test with emoji 🙈 and other characters:
- Monkey emoji: 🙈
- Thumbs up: 👍
- Heart: ❤️
- Thinking face: 🤔
- Rocket: 🚀
- Mixed text: Mario Zechner wann? Wo? Bin grad äußersr eventuninformiert 🙈
- Japanese: こんにちは
- Chinese: 你好
- Mathematical symbols: ∑∫∂√
- Special quotes: "curly" 'quotes'`,
      },
    ],
    isError: false,
    timestamp: currentTimeMillis(),
  };

  context.messages.push(toolResult, {
    role: "user",
    content: "Summarize the tool result briefly.",
    timestamp: currentTimeMillis(),
  });

  const response = await complete(llm, context, options);

  expect(response.stopReason).not.toBe("error");
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.length).toBeGreaterThan(0);
}

async function testRealWorldLinkedInData<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const toolCallId = llm.provider === "mistral" ? "linkedin1" : "linkedin_1";
  const context: Context = {
    systemPrompt: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Use the linkedin tool to get comments",
        timestamp: currentTimeMillis(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "linkedin_skill",
            arguments: {},
          },
        ],
        api: llm.api,
        provider: llm.provider,
        model: llm.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
      },
    ],
    tools: [
      {
        name: "linkedin_skill",
        description: "Get LinkedIn comments",
        parameters: emptySchema,
      },
    ],
  };

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCallId,
    toolName: "linkedin_skill",
    content: [
      {
        type: "text",
        text: `Post: Hab einen "Generative KI für Nicht-Techniker" Workshop gebaut.
Unanswered Comments: 2

=> {
  "comments": [
    {
      "author": "Matthias Neumayer's  graphic link",
      "text": "Leider nehmen das viel zu wenige Leute ernst"
    },
    {
      "author": "Matthias Neumayer's  graphic link",
      "text": "Mario Zechner wann? Wo? Bin grad äußersr eventuninformiert 🙈"
    }
  ]
}`,
      },
    ],
    isError: false,
    timestamp: currentTimeMillis(),
  };

  context.messages.push(toolResult, {
    role: "user",
    content: "How many comments are there?",
    timestamp: currentTimeMillis(),
  });

  const response = await complete(llm, context, options);

  expect(response.stopReason).not.toBe("error");
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.some((b) => b.type === "text")).toBe(true);
}

async function testUnpairedHighSurrogate<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const toolCallId = llm.provider === "mistral" ? "testtool2" : "test_2";
  const context: Context = {
    systemPrompt: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Use the test tool",
        timestamp: currentTimeMillis(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "test_tool",
            arguments: {},
          },
        ],
        api: llm.api,
        provider: llm.provider,
        model: llm.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
      },
    ],
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        parameters: emptySchema,
      },
    ],
  };

  const unpairedSurrogate = String.fromCharCode(0xd83d);

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCallId,
    toolName: "test_tool",
    content: [
      {
        type: "text",
        text: `Text with unpaired surrogate: ${unpairedSurrogate} <- should be sanitized`,
      },
    ],
    isError: false,
    timestamp: currentTimeMillis(),
  };

  context.messages.push(toolResult, {
    role: "user",
    content: "What did the tool return?",
    timestamp: currentTimeMillis(),
  });

  const response = await complete(llm, context, options);

  expect(response.stopReason).not.toBe("error");
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.length).toBeGreaterThan(0);
}

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google Provider Unicode Handling",
    () => {
      const llm = getModel("google", "gemini-2.5-flash");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider Unicode Handling",
    () => {
      const llm = getModel("openai", "gpt-4o-mini");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider Unicode Handling",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(!hasAzureOpenAICredentials())(
    "Azure OpenAI Responses Provider Unicode Handling",
    () => {
      const llm = getModel("azure", "gpt-4o-mini");
      const azureDeploymentName = resolveAzureDeploymentName(llm.id);
      const azureOptions =
        azureDeploymentName !== undefined && azureDeploymentName !== ""
          ? { azureDeploymentName }
          : {};

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm, azureOptions),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm, azureOptions),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm, azureOptions),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider Unicode Handling", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe("Anthropic OAuth Provider Unicode Handling", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle emoji in tool results",
      { retry: 3, timeout: 30000 },
      () => testEmojiInToolResults(llm, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm, { apiKey: anthropicOAuthToken }),
    );
  });

  describe.skipIf(envValue("XAI_API_KEY") === undefined || envValue("XAI_API_KEY") === "")(
    "xAI Provider Unicode Handling",
    () => {
      const llm = getModel("xai", "grok-4.3");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("GROQ_API_KEY") === undefined || envValue("GROQ_API_KEY") === "")(
    "Groq Provider Unicode Handling",
    () => {
      const llm = getModel("groq", "openai/gpt-oss-20b");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );

  describe.skipIf(
    envValue("CEREBRAS_API_KEY") === undefined || envValue("CEREBRAS_API_KEY") === "",
  )("Cerebras Provider Unicode Handling", () => {
    const llm = getModel("cerebras", "gpt-oss-120b");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(!hasCloudflareWorkersAICredentials())(
    "Cloudflare Workers AI Provider Unicode Handling",
    () => {
      const llm = getModel("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );

  describe.skipIf(!hasCloudflareAiGatewayCredentials())(
    "Cloudflare AI Gateway Provider Unicode Handling",
    () => {
      const llm = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("HF_TOKEN") === undefined || envValue("HF_TOKEN") === "")(
    "Hugging Face Provider Unicode Handling",
    () => {
      const llm = getModel("huggingface", "moonshotai/Kimi-K2.5");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );

  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI Provider Unicode Handling", () => {
    const llm = getModel("together", "moonshotai/Kimi-K3");
    const options = { reasoningEffort: "high" } satisfies StreamOptionsWithExtras;

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm, options),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm, options),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm, options),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten Provider Unicode Handling",
    () => {
      const llm = getModel("baseten", "zai-org/GLM-5.2");
      const options = { reasoningEffort: "high" } satisfies StreamOptionsWithExtras;

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm, options),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm, options),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm, options),
      );
    },
  );

  describe.skipIf(envValue("ZAI_API_KEY") === undefined || envValue("ZAI_API_KEY") === "")(
    "zAI Provider Unicode Handling",
    () => {
      const llm = getModel("zai", "glm-5.2");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider Unicode Handling",
    () => {
      const llm = getModel("mistral", "devstral-medium-latest");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );

  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax Provider Unicode Handling",
    () => {
      const llm = getModel("minimax", "MiniMax-M2.7");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing) Provider Unicode Handling",
    () => {
      const llm = getModel("xiaomi", "mimo-v2.6-pro");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN) Provider Unicode Handling", () => {
    const llm = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS) Provider Unicode Handling", () => {
    const llm = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP) Provider Unicode Handling", () => {
    const llm = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Provider Unicode Handling", () => {
    const llm = getModel("qwen-token-plan", "qwen3.7-max");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual Provider Unicode Handling", () => {
    const llm = getModel("qwen-token-plan-individual", "qwen3.8-max");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN) Provider Unicode Handling", () => {
    const llm = getModel("qwen-token-plan-cn", "qwen3.7-max");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });

  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding Provider Unicode Handling",
    () => {
      const llm = getModel("kimi-coding", "kimi-for-coding");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider Unicode Handling", () => {
    const llm = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });

  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock Provider Unicode Handling", () => {
    const llm = getModel("amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe("OpenAI Codex Provider Unicode Handling", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle emoji in tool results",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() => testEmojiInToolResults(llm, { apiKey: openaiCodexToken }));
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() =>
              testRealWorldLinkedInData(llm, { apiKey: openaiCodexToken }),
            );
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() =>
              testUnpairedHighSurrogate(llm, { apiKey: openaiCodexToken }),
            );
          }),
        ),
    );
  });
});
