import { Type } from "typebox";

import modelSchema from "./model-schema.ts";

const { ModelCostSchema } = modelSchema;

function percentileCutoffs(metric: string) {
  return Type.Object({
    p50: Type.Optional(Type.Number({ description: `${metric} at the 50th percentile.` })),
    p75: Type.Optional(Type.Number({ description: `${metric} at the 75th percentile.` })),
    p90: Type.Optional(Type.Number({ description: `${metric} at the 90th percentile.` })),
    p99: Type.Optional(Type.Number({ description: `${metric} at the 99th percentile.` })),
  });
}

const OpenRouterRoutingSchema = Type.Object(
  {
    allow_fallbacks: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Whether to allow backup providers to serve requests.",
      }),
    ),
    data_collection: Type.Optional(
      Type.Union([Type.Literal("deny"), Type.Literal("allow")], {
        default: "allow",
        description:
          'Data collection setting. "allow": allow providers that may store or train on data. "deny": only use providers that do not collect user data.',
      }),
    ),
    enforce_distillable_text: Type.Optional(
      Type.Boolean({
        description: "Whether to restrict routing to only models that allow text distillation.",
      }),
    ),
    ignore: Type.Optional(
      Type.Array(Type.String(), {
        description: "List of provider names or slugs to skip for this request.",
      }),
    ),
    max_price: Type.Optional(
      Type.Object(
        {
          audio: Type.Optional(
            Type.Union([Type.Number(), Type.String()], { description: "Price per audio unit." }),
          ),
          completion: Type.Optional(
            Type.Union([Type.Number(), Type.String()], {
              description: "Price per million completion tokens.",
            }),
          ),
          image: Type.Optional(
            Type.Union([Type.Number(), Type.String()], { description: "Price per image." }),
          ),
          prompt: Type.Optional(
            Type.Union([Type.Number(), Type.String()], {
              description: "Price per million prompt tokens.",
            }),
          ),
          request: Type.Optional(
            Type.Union([Type.Number(), Type.String()], { description: "Price per request." }),
          ),
        },
        { description: "Maximum price per million tokens in USD." },
      ),
    ),
    only: Type.Optional(
      Type.Array(Type.String(), {
        description: "List of provider names or slugs to exclusively allow for this request.",
      }),
    ),
    order: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "An ordered list of provider names or slugs to try in sequence, falling back to the next if unavailable.",
      }),
    ),
    preferred_max_latency: Type.Optional(
      Type.Union([Type.Number(), percentileCutoffs("Maximum latency in seconds")], {
        description: "Preferred maximum latency in seconds. A number applies to p50.",
      }),
    ),
    preferred_min_throughput: Type.Optional(
      Type.Union([Type.Number(), percentileCutoffs("Minimum tokens per second")], {
        description: "Preferred minimum throughput in tokens per second. A number applies to p50.",
      }),
    ),
    quantizations: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'A list of quantization levels to filter providers by, for example ["fp16", "bf16", "fp8", "fp6", "int8", "int4", "fp4", "fp32"].',
      }),
    ),
    require_parameters: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether to filter providers to only those that support all parameters in the request.",
      }),
    ),
    sort: Type.Optional(
      Type.Union(
        [
          Type.String(),
          Type.Object({
            by: Type.Optional(
              Type.String({
                description: 'The sorting metric, such as "price", "throughput", or "latency".',
              }),
            ),
            partition: Type.Optional(
              Type.Union([Type.String(), Type.Null()], {
                default: "model",
                description: 'Partitioning strategy: "model" or "none".',
              }),
            ),
          }),
        ],
        {
          description:
            'Sorting strategy. Can be a string such as "price", "throughput", or "latency", or an object.',
        },
      ),
    ),
    zdr: Type.Optional(
      Type.Boolean({
        description: "Whether to restrict routing to only ZDR (Zero Data Retention) endpoints.",
      }),
    ),
  },
  {
    description:
      "OpenRouter provider routing preferences. Controls which upstream providers OpenRouter routes requests to. Sent as the provider field in the OpenRouter API request body. See https://openrouter.ai/docs/guides/routing/provider-selection.",
  },
);

const AnthropicAllowedFallbackModelSchema = Type.Object(
  {
    cost: ModelCostSchema,
    model: Type.String({ minLength: 1 }),
    provider: Type.String({ minLength: 1 }),
  },
  { description: "An Anthropic server-side refusal fallback model with local pricing metadata." },
);

const routingSchema = {
  AnthropicAllowedFallbackModelSchema,
  OpenRouterRoutingSchema,
};

export default routingSchema;
