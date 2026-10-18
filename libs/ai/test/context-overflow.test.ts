import type { ChildProcess } from "child_process";
import { execSync, spawn } from "child_process";

import { Clock, Console, Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { complete, getModel, getModels } from "../src/compat.ts";
import type { AssistantMessage, Context, Model, Usage } from "../src/types.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";
import { hasAzureOpenAICredentials } from "./azure-utils.ts";
import { hasBedrockCredentials } from "./bedrock-utils.ts";
import { envValue } from "./env.ts";
import { resolveApiKey } from "./oauth.ts";

const openaiCodexToken = await resolveApiKey("openai-codex");

const LOREM_IPSUM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. `;

function generateOverflowContent(contextWindow: number): string {
  const targetTokens = contextWindow + 10000;
  const targetChars = targetTokens * 4 * 1.5;
  const repetitions = Math.ceil(targetChars / LOREM_IPSUM.length);
  return LOREM_IPSUM.repeat(repetitions);
}

interface OverflowResult {
  provider: string;
  model: string;
  contextWindow: number;
  stopReason: string;
  errorMessage: string | undefined;
  usage: Usage;
  hasUsageData: boolean;
  response: AssistantMessage;
}

function testContextOverflow(model: Model<any>, apiKey: string): Promise<OverflowResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const overflowContent = generateOverflowContent(model.contextWindow);

      const context: Context = {
        systemPrompt: "You are a helpful assistant.",
        messages: [
          {
            role: "user",
            content: overflowContent,
            timestamp: yield* Clock.currentTimeMillis,
          },
        ],
      };

      const response = yield* Effect.promise(() => complete(model, context, { apiKey }));

      const hasUsageData = response.usage.input > 0 || response.usage.cacheRead > 0;

      return {
        provider: model.provider,
        model: model.id,
        contextWindow: model.contextWindow,
        stopReason: response.stopReason,
        errorMessage: response.errorMessage,
        usage: response.usage,
        hasUsageData,
        response,
      };
    }),
  );
}

function logResult(result: OverflowResult) {
  console.log(`\n${result.provider} / ${result.model}:`);
  console.log(`  contextWindow: ${result.contextWindow}`);
  console.log(`  stopReason: ${result.stopReason}`);
  console.log(`  errorMessage: ${result.errorMessage}`);
  console.log(`  usage: ${JSON.stringify(result.usage)}`);
  console.log(`  hasUsageData: ${result.hasUsageData}`);
}

describe("Context overflow error handling", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic (API Key)", () => {
    it(
      "claude-haiku-4-5 - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("anthropic", "claude-haiku-4-5");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("ANTHROPIC_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/prompt is too long/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(
    envValue("ANTHROPIC_OAUTH_TOKEN") === undefined || envValue("ANTHROPIC_OAUTH_TOKEN") === "",
  )("Anthropic (OAuth)", () => {
    it(
      "claude-sonnet-4 - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("anthropic", "claude-sonnet-4-6");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("ANTHROPIC_OAUTH_TOKEN")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/prompt is too long/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions",
    () => {
      it(
        "gpt-4o-mini - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = { ...getModel("openai", "gpt-4o-mini") };
              model.api = "openai-completions" as any;
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("OPENAI_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(result.errorMessage).toMatch(/maximum context length/iu);
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses",
    () => {
      it(
        "gpt-4o - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("openai", "gpt-4o");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("OPENAI_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(result.errorMessage).toMatch(/exceeds the context window/iu);
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses", () => {
    it(
      "gpt-4o-mini - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("azure", "gpt-4o-mini");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("AZURE_OPENAI_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/context|maximum/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google",
    () => {
      it(
        "gemini-2.5-flash - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("google", "gemini-2.5-flash");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("GEMINI_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(result.errorMessage).toMatch(/input token count.*exceeds the maximum/iu);
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe("OpenAI Codex (OAuth)", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openai-codex", "gpt-5.5");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, openaiCodexToken!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock", () => {
    it(
      "claude-sonnet-4-5 - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel(
              "amazon-bedrock",
              "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
            );
            const result = yield* Effect.promise(() => testContextOverflow(model, ""));
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(envValue("XAI_API_KEY") === undefined || envValue("XAI_API_KEY") === "")(
    "xAI",
    () => {
      it(
        "grok-4.3 - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("xai", "grok-4.3");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("XAI_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(result.errorMessage).toMatch(/maximum prompt length is \d+/iu);
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(envValue("GROQ_API_KEY") === undefined || envValue("GROQ_API_KEY") === "")(
    "Groq",
    () => {
      it(
        "llama-3.3-70b-versatile - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("groq", "llama-3.3-70b-versatile");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("GROQ_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(result.errorMessage).toMatch(/reduce the length of the messages/iu);
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(
    envValue("CEREBRAS_API_KEY") === undefined || envValue("CEREBRAS_API_KEY") === "",
  )("Cerebras", () => {
    it(
      "available model - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const preferredCerebrasModelIds: ReadonlySet<string> = new Set([
              "gpt-oss-120b",
              "zai-glm-4.7",
              "llama3.1-8b",
            ]);
            const cerebrasModels = getModels("cerebras");
            const model =
              cerebrasModels.find((candidate) => preferredCerebrasModelIds.has(candidate.id)) ??
              cerebrasModels[0];
            if (model === undefined) {
              throw new Error("No Cerebras models available");
            }

            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("CEREBRAS_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/4(00|13|29).*\(no body\)/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(envValue("HF_TOKEN") === undefined || envValue("HF_TOKEN") === "")(
    "Hugging Face",
    () => {
      it(
        "Kimi-K2.5 - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("huggingface", "moonshotai/Kimi-K2.5");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("HF_TOKEN")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI", () => {
    it(
      "Kimi-K3 - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("together", "moonshotai/Kimi-K3");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("TOGETHER_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(envValue("ZAI_API_KEY") === undefined || envValue("ZAI_API_KEY") === "")(
    "z.ai",
    () => {
      it(
        "glm-5.2 - should detect overflow via isContextOverflow when z.ai reports it",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("zai", "glm-5.2");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("ZAI_API_KEY")!),
              );
              logResult(result);

              if (result.stopReason === "error") {
                if (/model_context_window_exceeded/iu.test(result.errorMessage ?? "")) {
                  expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
                } else {
                  yield* Console.log(
                    "  z.ai returned non-overflow error (possibly rate limited), skipping overflow detection",
                  );
                }
              } else if (result.stopReason === "stop") {
                if (result.hasUsageData && result.usage.input > model.contextWindow) {
                  expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
                } else {
                  yield* Console.log(
                    "  z.ai returned stop without overflow usage data, skipping overflow detection",
                  );
                }
              }
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral",
    () => {
      it(
        "devstral-medium-latest - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("mistral", "devstral-medium-latest");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("MISTRAL_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(result.errorMessage).toMatch(
                /too large for model with \d+ maximum context length/iu,
              );
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax",
    () => {
      it(
        "MiniMax-M2.7 - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("minimax", "MiniMax-M2.7");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("MINIMAX_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing)",
    () => {
      it(
        "mimo-v2.6-pro - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("xiaomi", "mimo-v2.6-pro");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("XIAOMI_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("length");
              expect(result.usage.output).toBe(0);
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN)", () => {
    it(
      "mimo-v2.6-pro - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("length");
            expect(result.usage.output).toBe(0);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS)", () => {
    it(
      "mimo-v2.6-pro - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("length");
            expect(result.usage.output).toBe(0);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP)", () => {
    it(
      "mimo-v2.6-pro - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("length");
            expect(result.usage.output).toBe(0);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan", () => {
    it(
      "qwen3.7-max - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("qwen-token-plan", "qwen3.7-max");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("QWEN_TOKEN_PLAN_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/input length/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual", () => {
    it(
      "qwen3.8-max - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("qwen-token-plan-individual", "qwen3.8-max");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("QWEN_TOKEN_PLAN_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/input length/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN)", () => {
    it(
      "qwen3.7-max - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("qwen-token-plan-cn", "qwen3.7-max");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("QWEN_TOKEN_PLAN_CN_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/input length/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding",
    () => {
      it(
        "kimi-for-coding - should detect overflow via isContextOverflow",
        () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const model = getModel("kimi-coding", "kimi-for-coding");
              const result = yield* Effect.promise(() =>
                testContextOverflow(model, envValue("KIMI_API_KEY")!),
              );
              logResult(result);

              expect(result.stopReason).toBe("error");
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }),
          ),
        120000,
      );
    },
  );

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway", () => {
    it(
      "google/gemini-2.5-flash via AI Gateway - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("AI_GATEWAY_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter", () => {
    it(
      "anthropic/claude-sonnet-4.5 via OpenRouter - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openrouter", "anthropic/claude-sonnet-4.5");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("OPENROUTER_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );

    it(
      "deepseek/deepseek-v3.2 via OpenRouter - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openrouter", "deepseek/deepseek-v3.2");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("OPENROUTER_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );

    it(
      "mistralai/mistral-large-2512 via OpenRouter - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openrouter", "mistralai/mistral-large");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("OPENROUTER_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );

    it(
      "google/gemini-2.5-flash via OpenRouter - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openrouter", "google/gemini-2.5-flash");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("OPENROUTER_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );

    it(
      "meta-llama/llama-4-scout via OpenRouter - should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openrouter", "meta-llama/llama-4-scout");
            const result = yield* Effect.promise(() =>
              testContextOverflow(model, envValue("OPENROUTER_API_KEY")!),
            );
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/iu);
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  let ollamaInstalled = false;
  if (envValue("MSA_NO_LOCAL_LLM") === undefined || envValue("MSA_NO_LOCAL_LLM") === "") {
    try {
      execSync("which ollama", { stdio: "ignore" });
      ollamaInstalled = true;
    } catch {
      ollamaInstalled = false;
    }
  }

  describe.skipIf(!ollamaInstalled)("Ollama (local)", () => {
    let ollamaProcess: ChildProcess | null = null;
    let model: Model<"openai-completions">;

    beforeAll(async () => {
      try {
        execSync("ollama list | grep -q 'gpt-oss:20b'", { stdio: "ignore" });
      } catch {
        console.log("Pulling gpt-oss:20b model for Ollama overflow tests...");
        try {
          execSync("ollama pull gpt-oss:20b", { stdio: "inherit" });
        } catch {
          console.warn("Failed to pull gpt-oss:20b model, tests will be skipped");
          return;
        }
      }

      ollamaProcess = spawn("ollama", ["serve"], {
        detached: false,
        stdio: "ignore",
      });

      await new Promise<void>((resolve) => {
        const checkServer = async () => {
          try {
            const response = await fetch("http://localhost:11434/api/tags");
            if (response.ok) {
              resolve();
            } else {
              setTimeout(checkServer, 500);
            }
          } catch {
            setTimeout(checkServer, 500);
          }
        };
        setTimeout(checkServer, 1000);
      });

      model = {
        id: "gpt-oss:20b",
        api: "openai-completions",
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        name: "Ollama GPT-OSS 20B",
      };
    }, 60000);

    afterAll(() => {
      if (ollamaProcess !== null) {
        ollamaProcess.kill("SIGTERM");
        ollamaProcess = null;
      }
    });

    it(
      "gpt-oss:20b - should detect overflow via isContextOverflow (ollama silently truncates)",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const result = yield* Effect.promise(() => testContextOverflow(model, "ollama"));
            logResult(result);

            if (result.stopReason === "stop" && result.hasUsageData) {
              yield* Console.log(
                "  Ollama silently truncated input to",
                result.usage.input,
                "tokens",
              );
            } else if (result.stopReason === "error") {
              expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
            }
          }),
        ),
      300000,
    );
  });

  let lmStudioRunning = false;
  if (envValue("MSA_NO_LOCAL_LLM") === undefined || envValue("MSA_NO_LOCAL_LLM") === "") {
    try {
      execSync("curl -s --max-time 1 http://localhost:1234/v1/models > /dev/null", {
        stdio: "ignore",
      });
      lmStudioRunning = true;
    } catch {
      lmStudioRunning = false;
    }
  }

  describe.skipIf(!lmStudioRunning)("LM Studio (local)", () => {
    it(
      "should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model: Model<"openai-completions"> = {
              id: "local-model",
              api: "openai-completions",
              provider: "lm-studio",
              baseUrl: "http://localhost:1234/v1",
              reasoning: false,
              input: ["text"],
              contextWindow: 8192,
              maxTokens: 2048,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              name: "LM Studio Local Model",
            };

            const result = yield* Effect.promise(() => testContextOverflow(model, "lm-studio"));
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });

  let llamaCppRunning = false;
  if (envValue("MSA_NO_LOCAL_LLM") === undefined || envValue("MSA_NO_LOCAL_LLM") === "") {
    try {
      execSync("curl -s --max-time 1 http://localhost:8081/health > /dev/null", {
        stdio: "ignore",
      });
      const probeStatus = execSync(
        'curl -s --max-time 1 -o /dev/null -w \'%{http_code}\' -X POST http://localhost:8081/v1/completions -H \'content-type: application/json\' -d \'{"model":"local-model","prompt":"ping","max_tokens":1}\'',
        { encoding: "utf8" },
      ).trim();
      llamaCppRunning = probeStatus !== "404" && probeStatus !== "405" && probeStatus !== "000";
    } catch {
      llamaCppRunning = false;
    }
  }

  describe.skipIf(!llamaCppRunning)("llama.cpp (local)", () => {
    it(
      "should detect overflow via isContextOverflow",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model: Model<"openai-completions"> = {
              id: "local-model",
              api: "openai-completions",
              provider: "llama.cpp",
              baseUrl: "http://localhost:8081/v1",
              reasoning: false,
              input: ["text"],
              contextWindow: 4096,
              maxTokens: 2048,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              name: "llama.cpp Local Model",
            };

            const result = yield* Effect.promise(() => testContextOverflow(model, "llama.cpp"));
            logResult(result);

            expect(result.stopReason).toBe("error");
            expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
          }),
        ),
      120000,
    );
  });
});
