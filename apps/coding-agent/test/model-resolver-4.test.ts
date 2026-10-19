import type { Model } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { findInitialModel } from "../src/core/model-resolver.ts";

describe("default model selection", () => {
  test("findInitialModel selects an available gateway model", () =>
    runTest(
      Effect.gen(function* () {
        const gatewayModel: Model<"anthropic-messages"> = {
          id: "anthropic/claude-opus-4-6",
          name: "Claude Opus 4.6",
          api: "anthropic-messages" as const,
          provider: "custom-gateway",
          baseUrl: "https://gateway.example.test",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
          contextWindow: 200000,
          maxTokens: 8192,
        };

        const registry = {
          getAvailableSnapshot: () => [gatewayModel],
        } as unknown as Parameters<typeof findInitialModel>[0]["modelRuntime"];

        const result = yield* awaited(
          findInitialModel({
            scopedModels: [],
            isContinuing: false,
            modelRuntime: registry,
          }),
        );

        expect(result.model?.provider).toBe("custom-gateway");
        expect(result.model?.id).toBe("anthropic/claude-opus-4-6");
      }),
    ));

  test("findInitialModel ignores an unauthenticated saved default", () =>
    runTest(
      Effect.gen(function* () {
        const savedDeepSeekModel: Model<"anthropic-messages"> = {
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          api: "anthropic-messages" as const,
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          reasoning: true,
          input: ["text"],
          cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
          contextWindow: 128000,
          maxTokens: 8192,
        };
        const localDeepSeekModel: Model<"anthropic-messages"> = {
          ...savedDeepSeekModel,
          provider: "spark-two",
          baseUrl: "http://spark-two:8000/v1",
        };
        const registry = {
          getModel: (provider: string, modelId: string) =>
            provider === savedDeepSeekModel.provider && modelId === savedDeepSeekModel.id
              ? savedDeepSeekModel
              : undefined,
          hasConfiguredAuth: (provider: string) => provider === "spark-two",
          getAvailableSnapshot: () => [localDeepSeekModel],
        } as unknown as Parameters<typeof findInitialModel>[0]["modelRuntime"];

        const result = yield* awaited(
          findInitialModel({
            scopedModels: [],
            isContinuing: false,
            defaultProvider: "deepseek",
            defaultModelId: "deepseek-v4-flash",
            modelRuntime: registry,
          }),
        );

        expect(result.model?.provider).toBe("spark-two");
        expect(result.model?.id).toBe("deepseek-v4-flash");
      }),
    ));
});
