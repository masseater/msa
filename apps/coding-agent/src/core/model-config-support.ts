import compatSchema from "@msa/ai/providers/compat-schema";
import modelSchema from "@msa/ai/providers/model-schema";
import { Type } from "typebox";
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
const ModelsConfigSchema = Type.Object({
  $schema: Type.Optional(Type.String()),
  ...ModelsConfigProperties,
});

const modelConfigSupport = {
  ModelDefinitionSchema,
  ModelOverrideSchema,
  ModelsConfigSchema,
  ProviderConfigSchema,
};

export default modelConfigSupport;
