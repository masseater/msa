import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import initialModel from "../src/core/initial-model.ts";

const { findInitialModel } = initialModel;

const { awaited, runTest } = testing;

const findinitialmodelSelectsAnAvailableGatewayModel = () =>
  runTest(
    Effect.gen(function* () {
      const gatewayModel: aiTypes.Model<"anthropic-messages"> = {
        api: "anthropic-messages" as const,
        baseUrl: "https://gateway.example.test",
        contextWindow: 200000,
        cost: { cacheRead: 0.5, cacheWrite: 5, input: 5, output: 15 },
        id: "anthropic/claude-opus-4-6",
        input: ["text", "image"],
        maxTokens: 8192,
        name: "Claude Opus 4.6",
        provider: "custom-gateway",
        reasoning: true,
      };

      const registry = {
        getAvailableSnapshot: () => [gatewayModel],
      } as unknown as Parameters<typeof findInitialModel>[0]["modelRuntime"];

      const result = yield* awaited(
        findInitialModel({
          isContinuing: false,
          modelRuntime: registry,
          scopedModels: [],
        }),
      );

      expect(result.model?.provider).toBe("custom-gateway");
      expect(result.model?.id).toBe("anthropic/claude-opus-4-6");
    }),
  );

const findinitialmodelIgnoresAnUnauthenticatedSavedDefault = () =>
  runTest(
    Effect.gen(function* () {
      const savedDeepSeekModel: aiTypes.Model<"anthropic-messages"> = {
        api: "anthropic-messages" as const,
        baseUrl: "https://api.deepseek.com",
        contextWindow: 128000,
        cost: { cacheRead: 0.1, cacheWrite: 1, input: 1, output: 2 },
        id: "deepseek-v4-flash",
        input: ["text"],
        maxTokens: 8192,
        name: "DeepSeek V4 Flash",
        provider: "deepseek",
        reasoning: true,
      };
      const localDeepSeekModel: aiTypes.Model<"anthropic-messages"> = {
        ...savedDeepSeekModel,
        baseUrl: "http://spark-two:8000/v1",
        provider: "spark-two",
      };
      const registry = {
        getAvailableSnapshot: () => [localDeepSeekModel],
        getModel: (provider: string, modelId: string) =>
          provider === savedDeepSeekModel.provider && modelId === savedDeepSeekModel.id
            ? savedDeepSeekModel
            : undefined,
        hasConfiguredAuth: (provider: string) => provider === "spark-two",
      } as unknown as Parameters<typeof findInitialModel>[0]["modelRuntime"];

      const result = yield* awaited(
        findInitialModel({
          defaultModelId: "deepseek-v4-flash",
          defaultProvider: "deepseek",
          isContinuing: false,
          modelRuntime: registry,
          scopedModels: [],
        }),
      );

      expect(result.model?.provider).toBe("spark-two");
      expect(result.model?.id).toBe("deepseek-v4-flash");
    }),
  );

describe("default model selection", () => {
  test(
    "findInitialModel selects an available gateway model",
    findinitialmodelSelectsAnAvailableGatewayModel,
  );

  test(
    "findInitialModel ignores an unauthenticated saved default",
    findinitialmodelIgnoresAnUnauthenticatedSavedDefault,
  );
});
