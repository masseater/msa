import { Clock, Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getModel, getModels, stream } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions } from "../src/types.ts";
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

function testTokensOnAbort<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const context: Context = {
        messages: [
          {
            role: "user",
            content: "Write a long poem with 20 stanzas about the beauty of nature.",
            timestamp: yield* Clock.currentTimeMillis,
          },
        ],
        systemPrompt: "You are a helpful assistant.",
      };

      const abortScope = yield* Scope.make();
      const signal = yield* Scope.provide(abortScope)(Effect.abortSignal);
      const response = stream(llm, context, { ...options, signal });

      let abortFired = false;
      let text = "";
      yield* Stream.fromAsyncIterable(response, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (!abortFired && (event.type === "text_delta" || event.type === "thinking_delta")) {
              text += event.delta;
              if (text.length >= 1000) {
                abortFired = true;
                yield* Scope.close(abortScope, Exit.void);
              }
            }
          }),
        ),
      );

      const msg = yield* Effect.promise(() => response.result());

      expect(msg.stopReason).toBe("aborted");

      if (
        llm.api === "openai-completions" ||
        llm.api === "mistral-conversations" ||
        llm.api === "openai-responses" ||
        llm.api === "azure-openai-responses" ||
        llm.api === "openai-codex-responses" ||
        llm.provider === "zai" ||
        llm.provider === "amazon-bedrock" ||
        llm.provider === "vercel-ai-gateway"
      ) {
        expect(msg.usage.input).toBe(0);
        expect(msg.usage.output).toBe(0);
      } else if (llm.provider === "minimax") {
        expect(msg.usage.input).toBe(0);
        expect(msg.usage.output).toBe(0);
      } else if (llm.provider === "kimi-coding") {
        expect(msg.usage.input).toBeGreaterThan(0);
        expect(msg.usage.output).toBe(0);
      } else {
        expect(msg.usage.input).toBeGreaterThan(0);
        expect(msg.usage.output).toBeGreaterThan(0);

        if (llm.cost.input > 0) {
          expect(msg.usage.cost.input).toBeGreaterThan(0);
          expect(msg.usage.cost.total).toBeGreaterThan(0);
        }
      }
    }),
  );
}

describe("Token Statistics on Abort", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google Provider",
    () => {
      const llm = getModel("google", "gemini-2.5-flash");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm, { thinking: { enabled: true } }),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider",
    () => {
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
      void _compat;
      const llm: Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider",
    () => {
      const llm = getModel("openai", "gpt-5.4-mini");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm, { reasoningEffort: "low" }),
      );
    },
  );
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses Provider", () => {
    const llm = getModel("azure", "gpt-4o-mini");
    const azureDeploymentName = resolveAzureDeploymentName(llm.id);
    const azureOptions =
      azureDeploymentName !== undefined && azureDeploymentName !== ""
        ? { azureDeploymentName }
        : {};

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm, azureOptions),
    );
  });
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider", () => {
    const llm = getModel("anthropic", "claude-sonnet-4-6");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });

  describe.skipIf(envValue("XAI_API_KEY") === undefined || envValue("XAI_API_KEY") === "")(
    "xAI Provider",
    () => {
      const llm = getModel("xai", "grok-4.3");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(envValue("GROQ_API_KEY") === undefined || envValue("GROQ_API_KEY") === "")(
    "Groq Provider",
    () => {
      const llm = getModel("groq", "openai/gpt-oss-20b");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(
    envValue("CEREBRAS_API_KEY") === undefined || envValue("CEREBRAS_API_KEY") === "",
  )("Cerebras Provider", () => {
    const preferredCerebrasModelIds: string[] = ["gpt-oss-120b", "zai-glm-4.7", "llama3.1-8b"];
    const cerebrasModels = getModels("cerebras");
    const llm =
      cerebrasModels.find((model) => preferredCerebrasModelIds.includes(model.id)) ??
      cerebrasModels[0];

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (llm === undefined) {
            throw new Error("No Cerebras models available");
          }

          yield* Effect.promise(() => testTokensOnAbort(llm));
        }),
      ),
    );
  });

  describe.skipIf(!hasCloudflareWorkersAICredentials())("Cloudflare Workers AI Provider", () => {
    const llm = getModel("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });

  describe.skipIf(!hasCloudflareAiGatewayCredentials())("Cloudflare AI Gateway Provider", () => {
    const llm = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });

  describe.skipIf(envValue("HF_TOKEN") === undefined || envValue("HF_TOKEN") === "")(
    "Hugging Face Provider",
    () => {
      const llm = getModel("huggingface", "moonshotai/Kimi-K2.5");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI Provider", () => {
    const llm = getModel("together", "moonshotai/Kimi-K3");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });

  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten Provider",
    () => {
      const llm = getModel("baseten", "zai-org/GLM-5.2");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm, { reasoningEffort: "high" }),
      );
    },
  );

  describe.skipIf(envValue("ZAI_API_KEY") === undefined || envValue("ZAI_API_KEY") === "")(
    "zAI Provider",
    () => {
      const llm = getModel("zai", "glm-5.2");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider",
    () => {
      const llm = getModel("mistral", "devstral-medium-latest");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax Provider",
    () => {
      const llm = getModel("minimax", "MiniMax-M2.7");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding Provider",
    () => {
      const llm = getModel("kimi-coding", "kimi-for-coding");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(envValue("META_API_KEY") === undefined || envValue("META_API_KEY") === "")(
    "Meta Provider",
    () => {
      const llm = getModel("meta", "muse-spark-1.3");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider", () => {
    const llm = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing) Provider",
    () => {
      const llm = getModel("xiaomi", "mimo-v2.6-pro");

      it.skip(
        "should include token stats when aborted mid-stream",
        { retry: 3, timeout: 30000 },
        () => testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN) Provider", () => {
    const llm = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");

    it.skip(
      "should include token stats when aborted mid-stream",
      { retry: 3, timeout: 30000 },
      () => testTokensOnAbort(llm),
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS) Provider", () => {
    const llm = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");

    it.skip(
      "should include token stats when aborted mid-stream",
      { retry: 3, timeout: 30000 },
      () => testTokensOnAbort(llm),
    );
  });
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP) Provider", () => {
    const llm = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");

    it.skip(
      "should include token stats when aborted mid-stream",
      { retry: 3, timeout: 30000 },
      () => testTokensOnAbort(llm),
    );
  });
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Provider", () => {
    const llm = getModel("qwen-token-plan", "qwen3.7-max");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual Provider", () => {
    const llm = getModel("qwen-token-plan-individual", "qwen3.8-max");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN) Provider", () => {
    const llm = getModel("qwen-token-plan-cn", "qwen3.7-max");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });

  describe("Anthropic OAuth Provider", () => {
    const llm = getModel("anthropic", "claude-sonnet-4-6");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should include token stats when aborted mid-stream",
      { retry: 3, timeout: 30000 },
      () => testTokensOnAbort(llm, { apiKey: anthropicOAuthToken }),
    );
  });
});

describe("Token Statistics on Abort", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should include token stats when aborted mid-stream",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() => testTokensOnAbort(llm, { apiKey: openaiCodexToken }));
          }),
        ),
    );
  });

  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock Provider", () => {
    const llm = getModel("amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });
});
