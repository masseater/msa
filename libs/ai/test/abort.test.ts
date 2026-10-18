import { Clock, Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel, stream } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions } from "../src/types.ts";
import { envValue } from "./env.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { hasBedrockCredentials } from "./bedrock-utils.ts";
import { resolveApiKey } from "./oauth.ts";

const [openaiCodexToken] = await Promise.all([resolveApiKey("openai-codex")]);

const testAbortSignal = Effect.fn("testAbortSignal")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: Context = {
    messages: [
      {
        role: "user",
        content: "What is 15 + 27? Think step by step. Then list 50 first names.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant.",
  };

  const abortScope = yield* Scope.make();
  const signal = yield* Scope.provide(abortScope)(Effect.abortSignal);
  let abortFired = false;
  let eventAfterAbort = false;
  let text = "";
  const response = stream(llm, context, { ...options, signal });
  yield* Stream.fromAsyncIterable(response, (error) => error).pipe(
    Stream.orDie,
    Stream.runForEachWhile((event) =>
      Effect.gen(function* () {
        if (abortFired) {
          eventAfterAbort = true;
          return false;
        }
        if (event.type === "text_delta" || event.type === "thinking_delta") {
          text += event.delta;
        }
        if (text.length >= 50) {
          yield* Scope.close(abortScope, Exit.void);
          abortFired = true;
        }
        return true;
      }),
    ),
  );
  if (eventAfterAbort) return;
  const msg = yield* Effect.promise(() => response.result());

  expect(msg.stopReason).toBe("aborted");
  expect(msg.content.length).toBeGreaterThan(0);

  context.messages.push(msg, {
    role: "user",
    content: "Please continue, but only generate 5 names.",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const followUp = yield* Effect.promise(() => complete(llm, context, options));
  expect(followUp.stopReason).toBe("stop");
  expect(followUp.content.length).toBeGreaterThan(0);
});

const testImmediateAbort = Effect.fn("testImmediateAbort")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const signal = AbortSignal.abort();

  const context: Context = {
    messages: [{ role: "user", content: "Hello", timestamp: yield* Clock.currentTimeMillis }],
  };

  const response = yield* Effect.promise(() => complete(llm, context, { ...options, signal }));
  expect(response.stopReason).toBe("aborted");
});

const testAbortThenNewMessage = Effect.fn("testAbortThenNewMessage")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const signal = AbortSignal.abort();

  const context: Context = {
    messages: [
      { role: "user", content: "Hello, how are you?", timestamp: yield* Clock.currentTimeMillis },
    ],
  };

  const abortedResponse = yield* Effect.promise(() =>
    complete(llm, context, { ...options, signal }),
  );
  expect(abortedResponse.stopReason).toBe("aborted");
  expect(abortedResponse.content.length).toBe(0);

  context.messages.push(abortedResponse, {
    role: "user",
    content: "What is 2 + 2?",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const followUp = yield* Effect.promise(() => complete(llm, context, options));
  expect(followUp.stopReason).toBe("stop");
  expect(followUp.content.length).toBeGreaterThan(0);
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google Provider Abort",
    () => {
      const llm = getModel("google", "gemini-2.5-flash");

      it("should abort mid-stream", { retry: 3 }, () =>
        Effect.runPromise(testAbortSignal(llm, { thinking: { enabled: true } })),
      );

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm, { thinking: { enabled: true } })),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider Abort",
    () => {
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
      void _compat;
      const llm: Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider Abort",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses Provider Abort", () => {
    const llm = getModel("azure", "gpt-4o-mini");
    const azureDeploymentName = resolveAzureDeploymentName(llm.id);
    const azureOptions =
      azureDeploymentName !== undefined && azureDeploymentName !== ""
        ? { azureDeploymentName }
        : {};

    it("should abort mid-stream", { retry: 3 }, () =>
      Effect.runPromise(testAbortSignal(llm, azureOptions)),
    );

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm, azureOptions)),
    );
  });

  describe.skipIf(
    envValue("ANTHROPIC_OAUTH_TOKEN") === undefined || envValue("ANTHROPIC_OAUTH_TOKEN") === "",
  )("Anthropic Provider Abort", () => {
    const llm = getModel("anthropic", "claude-sonnet-4-6");

    it("should abort mid-stream", { retry: 3 }, () =>
      Effect.runPromise(
        testAbortSignal(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      ),
    );

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(
        testImmediateAbort(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      ),
    );
  });

  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider Abort",
    () => {
      const llm = getModel("mistral", "devstral-medium-latest");

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI Provider Abort", () => {
    const llm = getModel("together", "moonshotai/Kimi-K3");

    it("should abort mid-stream", { retry: 3 }, () =>
      Effect.runPromise(testAbortSignal(llm, { reasoningEffort: "high" })),
    );

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm, { reasoningEffort: "high" })),
    );
  });

  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten Provider Abort",
    () => {
      const llm = getModel("baseten", "zai-org/GLM-5.2");

      it("should abort mid-stream", { retry: 3 }, () =>
        Effect.runPromise(testAbortSignal(llm, { reasoningEffort: "high" })),
      );

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm, { reasoningEffort: "high" })),
      );
    },
  );

  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax Provider Abort",
    () => {
      const llm = getModel("minimax", "MiniMax-M2.7");

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing) Provider Abort",
    () => {
      const llm = getModel("xiaomi", "mimo-v2.6-pro");

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (CN) Provider Abort", () => {
    const llm = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");

    it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );
  });

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (AMS) Provider Abort", () => {
    const llm = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");

    it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );
  });
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )("Xiaomi MiMo Token Plan (SGP) Provider Abort", () => {
    const llm = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");

    it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );
  });
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Provider Abort", () => {
    const llm = getModel("qwen-token-plan", "qwen3.7-max");

    it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual Provider Abort", () => {
    const llm = getModel("qwen-token-plan-individual", "qwen3.8-max");

    it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan (CN) Provider Abort", () => {
    const llm = getModel("qwen-token-plan-cn", "qwen3.7-max");

    it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );
  });
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding Provider Abort",
    () => {
      const llm = getModel("kimi-coding", "kimi-for-coding");

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider Abort", () => {
    const llm = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

    it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );
  });

  describe("OpenAI Codex Provider Abort", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should abort mid-stream",
      { retry: 3 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testAbortSignal(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle immediate abort",
      { retry: 3 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testImmediateAbort(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock Provider Abort", () => {
    const llm = getModel("amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0");

    it("should abort mid-stream", { retry: 3 }, () =>
      Effect.runPromise(testAbortSignal(llm, { reasoning: "medium" })),
    );

    it("should handle immediate abort", { retry: 3 }, () =>
      Effect.runPromise(testImmediateAbort(llm)),
    );

    it("should handle abort then new message", { retry: 3 }, () =>
      Effect.runPromise(testAbortThenNewMessage(llm)),
    );
  });
});
