import { type TSchemaOptions, Type } from "typebox";

const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const MODEL_THINKING_LEVELS = ["off", ...THINKING_LEVELS] as const;
const MODEL_INPUT_MODALITIES = ["text", "image"] as const;
const CACHE_RETENTIONS = ["none", "short", "long"] as const;
const MODEL_PROMPT_CACHE_RETENTIONS = ["short", "long"] as const;

const ThinkingLevelSchema = Type.Enum(THINKING_LEVELS);
const ModelThinkingLevelSchema = Type.Enum(MODEL_THINKING_LEVELS);
const ModelInputModalitySchema = Type.Enum(MODEL_INPUT_MODALITIES);
const CacheRetentionSchema = Type.Enum(CACHE_RETENTIONS);

const ThinkingLevelMapValueSchema = Type.Union([Type.String(), Type.Null()]);
const ThinkingLevelMapSchema = Type.Partial(
  Type.Record(ModelThinkingLevelSchema, ThinkingLevelMapValueSchema),
);

const ModelPromptCacheSchema = Type.Partial(
  Type.Record(Type.Enum(MODEL_PROMPT_CACHE_RETENTIONS), Type.Number({ exclusiveMinimum: 0 })),
  {
    description:
      "Best-effort prompt cache lifetime in seconds for each retention tier. A missing tier means the lifetime is unknown, so msa does not warm it.",
  },
);

const ModelCostRatesProperties = {
  cacheRead: Type.Number({ description: "Cache-read cost in USD per million tokens." }),
  cacheWrite: Type.Number({ description: "Cache-write cost in USD per million tokens." }),
  input: Type.Number({ description: "Input cost in USD per million tokens." }),
  output: Type.Number({ description: "Output cost in USD per million tokens." }),
};

const ModelCostRatesSchema = Type.Object(ModelCostRatesProperties);
const ModelCostTierSchema = Type.Object({
  inputTokensAbove: Type.Number({
    description: "Use this tier when total request input exceeds this token count.",
  }),
  ...ModelCostRatesProperties,
});
const ModelServiceTierCostSchema = Type.Partial(
  Type.Record(Type.Enum(["flex", "priority"]), Type.Number({ exclusiveMinimum: 0 })),
  {
    description:
      "Multiplier applied to every rate when a request runs on this service tier. A missing tier keeps the standard rates.",
  },
);
const ModelCostSchema = Type.Object({
  ...ModelCostRatesProperties,
  serviceTiers: Type.Optional(ModelServiceTierCostSchema),
  tiers: Type.Optional(
    Type.Array(ModelCostTierSchema, {
      description:
        "Request-wide pricing tiers. The highest matching input threshold applies to the full request.",
    }),
  ),
});

function modelImageResizeOptions(options?: TSchemaOptions) {
  return Type.Object(
    {
      jpegQuality: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
      maxBytes: Type.Optional(
        Type.Integer({ description: "Maximum base64-encoded payload size in bytes.", minimum: 1 }),
      ),
      maxHeight: Type.Optional(Type.Integer({ minimum: 1 })),
      maxWidth: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    options,
  );
}

const ModelImageResizeOptionsSchema = modelImageResizeOptions();

const ModelImageInputLimitsSchema = Type.Object({
  maxPerMessage: Type.Optional(
    Type.Integer({ description: "Maximum images accepted in one provider message.", minimum: 1 }),
  ),
  maxPerRequest: Type.Optional(
    Type.Integer({
      description: "Maximum images accepted across one provider request.",
      minimum: 1,
    }),
  ),
  resize: Type.Optional(
    modelImageResizeOptions({
      description:
        "Cache-safe resize profile applied before a new image enters conversation history.",
    }),
  ),
});

const ModelInputLimitsSchema = Type.Object({
  images: Type.Optional(ModelImageInputLimitsSchema),
  maxRequestBytes: Type.Optional(
    Type.Integer({ description: "Maximum serialized provider request size in bytes.", minimum: 1 }),
  ),
});

const modelSchema = {
  CACHE_RETENTIONS,
  CacheRetentionSchema,
  MODEL_INPUT_MODALITIES,
  MODEL_PROMPT_CACHE_RETENTIONS,
  MODEL_THINKING_LEVELS,
  ModelCostRatesSchema,
  ModelCostSchema,
  ModelCostTierSchema,
  ModelImageInputLimitsSchema,
  ModelImageResizeOptionsSchema,
  ModelInputLimitsSchema,
  ModelInputModalitySchema,
  ModelPromptCacheSchema,
  ModelServiceTierCostSchema,
  ModelThinkingLevelSchema,
  THINKING_LEVELS,
  ThinkingLevelMapSchema,
  ThinkingLevelSchema,
};

export default modelSchema;
