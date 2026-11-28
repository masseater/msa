import type aiTypes from "@msa/ai/index.types";
import { describe, expect, test } from "vite-plus/test";

import cliModelFlag from "../src/core/cli-model.ts";
import modelPolicy from "../src/core/model-policy.ts";
import modelResolverSupport from "./model-resolver-support.ts";

const { EMPTY_MODEL_POLICY } = modelPolicy;
const { resolveCliModel } = cliModelFlag;

const { allModels, mockModels } = modelResolverSupport;

function policyFreeRuntime(
  models: readonly unknown[] | (() => readonly unknown[]),
  hasConfiguredAuth?: (provider: string) => boolean,
) {
  const list = () => (typeof models === "function" ? models() : models);
  return {
    getCatalogModels: list,
    getModelPolicy: () => EMPTY_MODEL_POLICY,
    getModels: list,
    ...(hasConfiguredAuth === undefined ? {} : { hasConfiguredAuth }),
  } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];
}

const direct = { ...mockModels[0], id: "claude-sonnet-4-5", provider: "anthropic-api" };

const openrouter = {
  ...mockModels[0],
  id: "anthropic/claude-opus-5.5",
  provider: "openrouter",
};

const gateway = {
  ...mockModels[0],
  id: "anthropic/claude-opus-5.5",
  provider: "custom-gateway",
};

const registry2 = (configured: string[]) =>
  policyFreeRuntime([direct, openrouter, gateway], (provider) => configured.includes(provider));

const neuralwattModel: aiTypes.Model<"anthropic-messages"> = {
  api: "anthropic-messages" as const,
  baseUrl: "https://api.neuralwatt.com",
  contextWindow: 128000,
  cost: { cacheRead: 0.1, cacheWrite: 1, input: 1, output: 2 },
  id: "some-base-model",
  input: ["text"],
  maxTokens: 8192,
  name: "Some Base Model",
  provider: "neuralwatt",
  reasoning: false,
};

const modelsWithNeuralwatt = [...allModels, neuralwattModel];

type Query = Parameters<typeof resolveCliModel>[0];
type Resolved = Readonly<{
  provider: string;
  id: string;
  thinkingLevel?: string;
  reasoning?: boolean;
}>;
type Expected = Readonly<{ resolved: Resolved }> | Readonly<{ failure: readonly string[] }>;
type Row = readonly [
  name: string,
  query: Omit<Query, "modelRuntime">,
  runtime: Query["modelRuntime"],
  expected: Expected,
];

const NEURALWATT = "neuralwatt/zai-org/GLM-5.1-FP8";
const neuralwatt = policyFreeRuntime(modelsWithNeuralwatt);
const customId = { id: "zai-org/GLM-5.1-FP8", provider: "neuralwatt" };

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const ROWS: readonly Row[] = [
  [
    "does not strip invalid :suffix as thinking level in --model (treat as raw id)",
    { cliModel: "gpt-4o:extended", cliProvider: "openai" },
    policyFreeRuntime(allModels),
    { resolved: { id: "gpt-4o:extended", provider: "openai" } },
  ],
  [
    "allows custom model ids for explicit providers without double prefixing",
    { cliModel: "openrouter/openai/ghost-model", cliProvider: "openrouter" },
    policyFreeRuntime(allModels),
    { resolved: { id: "openai/ghost-model", provider: "openrouter" } },
  ],
  [
    "returns a clear error when there are no models",
    { cliModel: "gpt-4o", cliProvider: "openai" },
    policyFreeRuntime([]),
    { failure: ["No models available"] },
  ],
  [
    "selects the authenticated gateway without a thinking suffix",
    { cliModel: "anthropic/claude-opus-5.5" },
    registry2(["custom-gateway"]),
    { resolved: { id: "anthropic/claude-opus-5.5", provider: "custom-gateway" } },
  ],
  [
    "selects the authenticated gateway with a thinking suffix",
    { cliModel: "anthropic/claude-opus-5.5:high" },
    registry2(["custom-gateway"]),
    {
      resolved: {
        id: "anthropic/claude-opus-5.5",
        provider: "custom-gateway",
        thinkingLevel: "high",
      },
    },
  ],
  [
    "reports ambiguity instead of choosing by catalog order",
    { cliModel: "anthropic/claude-opus-5.5" },
    registry2([]),
    {
      failure: [
        "custom-gateway/anthropic/claude-opus-5.5, openrouter/anthropic/claude-opus-5.5",
        "No matching provider is authenticated. Use --provider or provider/model.",
      ],
    },
  ],
  [
    "does not let stored credentials choose the provider for --api-key",
    { cliModel: "anthropic/claude-opus-5.5", inlineApiKey: true },
    registry2(["custom-gateway"]),
    { failure: ["--api-key does not choose a provider."] },
  ],
  [
    "strips :thinking suffix from custom model id in fallback path",
    { cliModel: `${NEURALWATT}:high` },
    neuralwatt,
    { resolved: { ...customId, reasoning: true, thinkingLevel: "high" } },
  ],
  [
    "custom model without thinking suffix works normally in fallback path",
    { cliModel: NEURALWATT },
    neuralwatt,
    { resolved: customId },
  ],
  ...THINKING_LEVELS.map((level): Row => [
    `all valid thinking levels work in fallback path (${level})`,
    { cliModel: `${NEURALWATT}:${level}` },
    neuralwatt,
    { resolved: { ...customId, thinkingLevel: level } },
  ]),
  [
    "invalid thinking suffix on custom model is treated as part of model id",
    { cliModel: `${NEURALWATT}:banana` },
    neuralwatt,
    { resolved: { id: "zai-org/GLM-5.1-FP8:banana", provider: "neuralwatt" } },
  ],
  [
    "explicit --provider with custom model:thinking strips suffix correctly",
    { cliModel: "zai-org/GLM-5.1-FP8:high", cliProvider: "neuralwatt" },
    neuralwatt,
    { resolved: { ...customId, thinkingLevel: "high" } },
  ],
  [
    "with explicit --thinking, :suffix is kept as part of model id",
    { cliModel: `${NEURALWATT}:high`, cliThinking: "medium" },
    neuralwatt,
    { resolved: { id: "zai-org/GLM-5.1-FP8:high", provider: "neuralwatt" } },
  ],
];

describe("resolveCliModel", () => {
  for (const [name, query, modelRuntime, expected] of ROWS) {
    test(name, () => {
      const result = resolveCliModel({ ...query, modelRuntime });
      if ("failure" in expected) {
        expect(result.model).toBeUndefined();
        for (const message of expected.failure) expect(result.error).toContain(message);
        return;
      }
      const { provider, id, thinkingLevel, reasoning } = expected.resolved;
      expect(result.error).toBeUndefined();
      expect(result.model?.provider).toBe(provider);
      expect(result.model?.id).toBe(id);
      expect(result.thinkingLevel).toBe(thinkingLevel);
      if (reasoning !== undefined) expect(result.model?.reasoning).toBe(reasoning);
    });
  }
});
