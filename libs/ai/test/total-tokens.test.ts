import { Clock, Console, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions, Usage } from "../src/types.ts";
import { envValue, readEnv } from "./env.ts";

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

const LONG_SYSTEM_PROMPT = `You are a helpful assistant. Be concise in your responses.

Here is some additional context that makes this system prompt long enough to trigger caching:

${Array(50)
  .fill(
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  )
  .join("\n\n")}

Remember: Always be helpful and concise.`;

const testTotalTokensWithCache = Effect.fn("testTotalTokensWithCache")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context1: Context = {
    systemPrompt: LONG_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: "What is 2 + 2? Reply with just the number.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response1 = yield* Effect.promise(() => complete(llm, context1, options));
  expect(response1.stopReason).toBe("stop");

  const context2: Context = {
    systemPrompt: LONG_SYSTEM_PROMPT,
    messages: [
      ...context1.messages,
      response1,
      {
        role: "user",
        content: "What is 3 + 3? Reply with just the number.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response2 = yield* Effect.promise(() => complete(llm, context2, options));
  expect(response2.stopReason).toBe("stop");

  return { first: response1.usage, second: response2.usage };
});

function logUsage(label: string, usage: Usage) {
  const computed = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  console.log(`  ${label}:`);
  console.log(
    `    input: ${usage.input}, output: ${usage.output}, cacheRead: ${usage.cacheRead}, cacheWrite: ${usage.cacheWrite}`,
  );
  console.log(`    totalTokens: ${usage.totalTokens}, computed: ${computed}`);
}

function assertTotalTokensEqualsComponents(usage: Usage) {
  const computed = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  expect(usage.totalTokens).toBe(computed);
}

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic (API Key)", () => {
    it(
      "claude-sonnet-4-5 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("anthropic", "claude-sonnet-4-5");

            yield* Console.log(`\nAnthropic / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("ANTHROPIC_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);

            const hasCache = second.cacheRead > 0 || second.cacheWrite > 0 || first.cacheWrite > 0;
            expect(hasCache).toBe(true);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe("Anthropic (OAuth)", () => {
    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "claude-sonnet-4 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("anthropic", "claude-sonnet-4-6");

            yield* Console.log(`\nAnthropic OAuth / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: anthropicOAuthToken,
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);

            const hasCache = second.cacheRead > 0 || second.cacheWrite > 0 || first.cacheWrite > 0;
            expect(hasCache).toBe(true);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions",
    () => {
      it(
        "gpt-4o-mini - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
              void _compat;
              const llm: Model<"openai-completions"> = {
                ...baseModel,
                api: "openai-completions",
              };

              yield* Console.log(`\nOpenAI Completions / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm);

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses",
    () => {
      it(
        "claude-haiku-4.5 - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("openai", "gpt-4o");

              yield* Console.log(`\nOpenAI Responses / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm);

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses", () => {
    it(
      "gpt-4o-mini - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("azure", "gpt-4o-mini");
            const azureDeploymentName = resolveAzureDeploymentName(llm.id);
            const azureOptions =
              azureDeploymentName !== undefined && azureDeploymentName !== ""
                ? { azureDeploymentName }
                : {};

            yield* Console.log(`\nAzure OpenAI Responses / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, azureOptions);

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google",
    () => {
      it(
        "gemini-2.5-flash - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("google", "gemini-2.5-flash");

              yield* Console.log(`\nGoogle / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm);

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("XAI_API_KEY") === undefined || envValue("XAI_API_KEY") === "")(
    "xAI",
    () => {
      it(
        "grok-4.3 - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("xai", "grok-4.3");

              yield* Console.log(`\nxAI / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("XAI_API_KEY"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("GROQ_API_KEY") === undefined || envValue("GROQ_API_KEY") === "")(
    "Groq",
    () => {
      it(
        "openai/gpt-oss-120b - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("groq", "openai/gpt-oss-120b");

              yield* Console.log(`\nGroq / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("GROQ_API_KEY"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("CEREBRAS_API_KEY") === undefined || envValue("CEREBRAS_API_KEY") === "",
  )("Cerebras", () => {
    it(
      "gpt-oss-120b - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("cerebras", "gpt-oss-120b");

            yield* Console.log(`\nCerebras / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("CEREBRAS_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });

  describe.skipIf(!hasCloudflareWorkersAICredentials())("Cloudflare Workers AI", () => {
    it(
      "@cf/moonshotai/kimi-k2.6 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6");

            yield* Console.log(`\nCloudflare Workers AI / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("CLOUDFLARE_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(!hasCloudflareAiGatewayCredentials())("Cloudflare AI Gateway", () => {
    it(
      "workers-ai/@cf/moonshotai/kimi-k2.6 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6");

            yield* Console.log(`\nCloudflare AI Gateway / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("CLOUDFLARE_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("HF_TOKEN") === undefined || envValue("HF_TOKEN") === "")(
    "Hugging Face",
    () => {
      it(
        "Kimi-K2.5 - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("huggingface", "moonshotai/Kimi-K2.5");

              yield* Console.log(`\nHugging Face / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("HF_TOKEN"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI", () => {
    it(
      "Kimi-K2.6 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("together", "moonshotai/Kimi-K3");

            yield* Console.log(`\nTogether AI / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("TOGETHER_API_KEY"),
              reasoningEffort: "high",
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten",
    () => {
      it(
        "GLM 5.2 - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("baseten", "zai-org/GLM-5.2");

              yield* Console.log(`\nBaseten / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("BASETEN_API_KEY"),
                reasoningEffort: "high",
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("ZAI_API_KEY") === undefined || envValue("ZAI_API_KEY") === "")(
    "z.ai",
    () => {
      it(
        "glm-5.2 - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("zai", "glm-5.2");

              yield* Console.log(`\nz.ai / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("ZAI_API_KEY"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral",
    () => {
      it(
        "devstral-medium-latest - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("mistral", "devstral-medium-latest");

              yield* Console.log(`\nMistral / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("MISTRAL_API_KEY"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax",
    () => {
      it(
        "MiniMax-M2.7 - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("minimax", "MiniMax-M2.7");

              yield* Console.log(`\nMiniMax / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("MINIMAX_API_KEY"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing)",
    () => {
      it(
        "mimo-v2.6-pro - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("xiaomi", "mimo-v2.6-pro");

              yield* Console.log(`\nXiaomi MiMo / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("XIAOMI_API_KEY"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN)", () => {
    it(
      "mimo-v2.6-pro - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");

            yield* Console.log(`\nXiaomi MiMo Token Plan CN / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("XIAOMI_TOKEN_PLAN_CN_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS)", () => {
    it(
      "mimo-v2.6-pro - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");

            yield* Console.log(`\nXiaomi MiMo Token Plan AMS / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("XIAOMI_TOKEN_PLAN_AMS_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP)", () => {
    it(
      "mimo-v2.6-pro - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");

            yield* Console.log(`\nXiaomi MiMo Token Plan SGP / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("XIAOMI_TOKEN_PLAN_SGP_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan", () => {
    it(
      "qwen3.7-max - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("qwen-token-plan", "qwen3.7-max");

            yield* Console.log(`\nQwen Token Plan / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("QWEN_TOKEN_PLAN_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual", () => {
    it(
      "qwen3.8-max - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("qwen-token-plan-individual", "qwen3.8-max");

            yield* Console.log(`\nQwen Token Plan Individual / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("QWEN_TOKEN_PLAN_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN)", () => {
    it(
      "qwen3.7-max - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("qwen-token-plan-cn", "qwen3.7-max");

            yield* Console.log(`\nQwen Token Plan CN / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("QWEN_TOKEN_PLAN_CN_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding",
    () => {
      it(
        "kimi-for-coding - should return totalTokens equal to sum of components",
        { retry: 3, timeout: 60000 },
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const llm = getModel("kimi-coding", "kimi-for-coding");

              yield* Console.log(`\nKimi For Coding / ${llm.id}:`);
              const { first, second } = yield* testTotalTokensWithCache(llm, {
                apiKey: yield* readEnv("KIMI_API_KEY"),
              });

              logUsage("First request", first);
              logUsage("Second request", second);

              assertTotalTokensEqualsComponents(first);
              assertTotalTokensEqualsComponents(second);
            }),
          ),
      );
    },
  );
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway", () => {
    it(
      "google/gemini-2.5-flash - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

            yield* Console.log(`\nVercel AI Gateway / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("AI_GATEWAY_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter", () => {
    it(
      "anthropic/claude-sonnet-4.5 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "anthropic/claude-sonnet-4.5");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );

    it(
      "deepseek/deepseek-chat - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "deepseek/deepseek-chat");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );

    it(
      "mistralai/mistral-small-3.2-24b-instruct - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "mistralai/mistral-small-3.2-24b-instruct");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );

    it(
      "google/gemini-2.5-flash - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "google/gemini-2.5-flash");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );

    it(
      "deepseek/deepseek-chat - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openrouter", "deepseek/deepseek-chat");

            yield* Console.log(`\nOpenRouter / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: yield* readEnv("OPENROUTER_API_KEY"),
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});

describe("totalTokens field", () => {
  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock", () => {
    it(
      "claude-sonnet-4-5 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel(
              "amazon-bedrock",
              "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
            );

            yield* Console.log(`\nAmazon Bedrock / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm);

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });

  describe("OpenAI Codex (OAuth)", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should return totalTokens equal to sum of components",
      { retry: 3, timeout: 60000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");

            yield* Console.log(`\nOpenAI Codex / ${llm.id}:`);
            const { first, second } = yield* testTotalTokensWithCache(llm, {
              apiKey: openaiCodexToken,
            });

            logUsage("First request", first);
            logUsage("Second request", second);

            assertTotalTokensEqualsComponents(first);
            assertTotalTokensEqualsComponents(second);
          }),
        ),
    );
  });
});
