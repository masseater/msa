import { readFile } from "node:fs/promises";

import compatSchema from "@msa/ai/providers/compat-schema";
import modelSchema from "@msa/ai/providers/model-schema";
import * as Effect from "effect/Effect";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";

import { stripJsonComments } from "../utils/json.ts";
import { normalizePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { awaited, awaiting } from "./awaiting.ts";

const {
  ModelCostSchema,
  ModelInputLimitsSchema,
  ModelInputModalitySchema,
  ModelPromptCacheSchema,
  ThinkingLevelMapSchema,
} = modelSchema;
const { ProviderCompatSchema } = compatSchema;

const SamplingParamsSchema = Type.Record(Type.String(), Type.Unknown());
const SamplingParamsByThinkingLevelSchema = Type.Object({
  high: Type.Optional(SamplingParamsSchema),
  low: Type.Optional(SamplingParamsSchema),
  max: Type.Optional(SamplingParamsSchema),
  medium: Type.Optional(SamplingParamsSchema),
  minimal: Type.Optional(SamplingParamsSchema),
  off: Type.Optional(SamplingParamsSchema),
  xhigh: Type.Optional(SamplingParamsSchema),
});

const PositiveTokenCountSchema = Type.Number({ exclusiveMinimum: 0 });

const ModelDefinitionSchema = Type.Object({
  api: Type.Optional(Type.String({ minLength: 1 })),
  baseUrl: Type.Optional(Type.String({ minLength: 1 })),
  compat: Type.Optional(ProviderCompatSchema),
  contextWindow: Type.Optional(PositiveTokenCountSchema),
  cost: Type.Optional(ModelCostSchema),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  id: Type.String({ minLength: 1 }),
  input: Type.Optional(Type.Array(ModelInputModalitySchema)),
  inputLimits: Type.Optional(ModelInputLimitsSchema),
  maxTokens: Type.Optional(PositiveTokenCountSchema),
  name: Type.Optional(Type.String({ minLength: 1 })),
  promptCache: Type.Optional(ModelPromptCacheSchema),
  reasoning: Type.Optional(Type.Boolean()),
  samplingParams: Type.Optional(SamplingParamsSchema),
  samplingParamsByThinkingLevel: Type.Optional(SamplingParamsByThinkingLevelSchema),
  thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
});

const ModelOverrideSchema = Type.Object({
  compat: Type.Optional(ProviderCompatSchema),
  contextWindow: Type.Optional(PositiveTokenCountSchema),
  cost: Type.Optional(Type.Partial(ModelCostSchema)),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  input: Type.Optional(Type.Array(ModelInputModalitySchema)),
  inputLimits: Type.Optional(ModelInputLimitsSchema),
  maxTokens: Type.Optional(PositiveTokenCountSchema),
  name: Type.Optional(Type.String({ minLength: 1 })),
  promptCache: Type.Optional(ModelPromptCacheSchema),
  reasoning: Type.Optional(Type.Boolean()),
  samplingParams: Type.Optional(SamplingParamsSchema),
  samplingParamsByThinkingLevel: Type.Optional(SamplingParamsByThinkingLevelSchema),
  thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
});

const ProviderConfigSchema = Type.Object({
  api: Type.Optional(Type.String({ minLength: 1 })),
  apiKey: Type.Optional(Type.String({ minLength: 1 })),
  authHeader: Type.Optional(Type.Boolean()),
  baseUrl: Type.Optional(Type.String({ minLength: 1 })),
  compat: Type.Optional(ProviderCompatSchema),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
  models: Type.Optional(Type.Array(ModelDefinitionSchema)),
  name: Type.Optional(Type.String({ minLength: 1 })),
});

const ModelsConfigProperties = {
  providers: Type.Record(Type.String(), ProviderConfigSchema),
};

export const ModelsConfigSchema = Type.Object({
  $schema: Type.Optional(Type.String()),
  ...ModelsConfigProperties,
});

const validateModelsConfig = Compile(ModelsConfigSchema);

export type ModelsJsonModel = Static<typeof ModelDefinitionSchema>;
export type ModelsJsonModelOverride = Static<typeof ModelOverrideSchema>;
export type ModelsJsonProvider = Static<typeof ProviderConfigSchema>;

function formatValidationPath(error: TLocalizedValidationError): string {
  if (error.keyword === "required") {
    const requiredProperties = (error.params as { requiredProperties?: string[] })
      .requiredProperties;
    const requiredProperty = requiredProperties?.[0];
    if (requiredProperty !== undefined && requiredProperty !== "") {
      const basePath = error.instancePath.replace(/^\//u, "").replace(/\//gu, ".");
      return basePath === "" ? requiredProperty : `${basePath}.${requiredProperty}`;
    }
  }
  const path = error.instancePath.replace(/^\//u, "").replace(/\//gu, ".");
  return path || "root";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export class ModelConfig {
  private readonly providers: ReadonlyMap<string, ModelsJsonProvider>;
  private readonly error: string | undefined;

  private constructor(providers: ReadonlyMap<string, ModelsJsonProvider>, error?: string) {
    this.providers = providers;
    this.error = error;
  }

  static load(modelsJsonPath: string | undefined): Promise<ModelConfig> {
    return Effect.runPromise(
      awaiting(function* () {
        if (modelsJsonPath === undefined || modelsJsonPath === "")
          return new ModelConfig(new Map());
        const path = normalizePath(modelsJsonPath);
        let content: string;
        try {
          content = yield* awaited(readFile(path, "utf-8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return new ModelConfig(new Map());
          return new ModelConfig(
            new Map(),
            `Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${path}`,
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(stripJsonComments(stripBom(content)));
        } catch (error) {
          return new ModelConfig(
            new Map(),
            `Failed to parse models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${path}`,
          );
        }

        if (!validateModelsConfig.Check(parsed)) {
          const errors =
            validateModelsConfig
              .Errors(parsed)
              .map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
              .join("\n") || "Unknown schema error";
          return new ModelConfig(
            new Map(),
            `Invalid models.json schema:\n${errors}\n\nFile: ${path}`,
          );
        }

        const providers = new Map<string, ModelsJsonProvider>();
        for (const [providerId, provider] of Object.entries(parsed.providers)) {
          providers.set(providerId, deepFreeze(structuredClone(provider)));
        }
        return new ModelConfig(providers);
      }),
    );
  }

  getProvider(providerId: string): ModelsJsonProvider | undefined {
    return this.providers.get(providerId);
  }

  getProviderIds(): readonly string[] {
    return [...this.providers.keys()];
  }

  getError(): string | undefined {
    return this.error;
  }
}
