import { type TProperties, Type } from "typebox";

import compatFieldsSchema from "./compat-fields-schema.ts";
import openaiCompatSchema from "./openai-compat-schema.ts";
import routingSchema from "./routing-schema.ts";

const { AnthropicAllowedFallbackModelSchema } = routingSchema;
const { optionalCompatBoolean, optionalSessionAffinityFormat } = compatFieldsSchema;
const { OpenAICompletionsCompatSchema, OpenAIResponsesCompatSchema } = openaiCompatSchema;

const AnthropicMessagesCompatSchema = Type.Object(
  {
    allowEmptySignature: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether to replay empty thinking signatures instead of converting thinking to text.",
      }),
    ),
    allowedFallbackModels: Type.Optional(
      Type.Array(AnthropicAllowedFallbackModelSchema, {
        description:
          "Models Anthropic accepts for server-side refusal fallback, with local pricing metadata for returned fallback responses. When absent or empty, callers must omit fallbacks; Anthropic rejects the field for models with no permitted fallback targets.",
        maxItems: 3,
      }),
    ),
    forceAdaptiveThinking: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether to force adaptive thinking (thinking.type: adaptive plus output_config.effort) regardless of model ID. Built-in models that require adaptive thinking set this in generated metadata. Custom Anthropic-compatible providers can set this to true for any model whose upstream requires the adaptive format. Set false to opt out on overridden built-in models.",
      }),
    ),
    sendSessionAffinityHeaders: optionalCompatBoolean({
      description:
        "Whether to send x-session-affinity from options.sessionId when caching is enabled. Required for providers that use session affinity for prompt cache routing; requests to the same replica maximize cache hits. Default: true for OpenRouter endpoints, false otherwise.",
    }),
    sessionAffinityFormat: Type.Optional(
      Type.Literal("openrouter", {
        description:
          "Session-affinity format. openrouter sends x-session-id; when unset, sends x-session-affinity.",
      }),
    ),
    supportsCacheControlOnTools: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Whether the provider supports Anthropic-style cache_control markers on tool definitions. When false, cache_control is omitted from tool parameters. Some Anthropic-compatible providers do not support this field on tools and may reject or ignore it.",
      }),
    ),
    supportsEagerToolInputStreaming: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Whether the provider accepts per-tool eager_input_streaming. When false, the Anthropic provider omits tools[].eager_input_streaming and sends the legacy fine-grained-tool-streaming-2025-05-14 beta header for tool-enabled requests.",
      }),
    ),
    supportsLongCacheRetention: optionalCompatBoolean({
      default: true,
      description:
        "Whether the provider supports Anthropic long cache retention through cache_control.ttl.",
    }),
    supportsMidConvoEffort: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether the exact model transport supports effort-only system messages and thinking binding controls.",
      }),
    ),
    supportsMidConvoSystemMessages: optionalCompatBoolean({
      default: false,
      description:
        "Whether the exact model accepts system-role messages inside the conversation. When false, later system messages are folded into the top-level system prompt.",
    }),
    supportsMidConvoToolChanges: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether the exact model accepts mid-conversation tool_addition and tool_removal blocks. Requires supportsMidConvoSystemMessages.",
      }),
    ),
    supportsStrictTools: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether the provider supports Anthropic strict tool schemas. Generated Anthropic models enable it explicitly.",
      }),
    ),
    supportsTemperature: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Whether the model accepts the Anthropic temperature request field. Claude Opus 4.7+ rejects non-default values.",
      }),
    ),
  },
  {
    additionalProperties: true,
    description: "Compatibility settings for Anthropic Messages-compatible APIs.",
  },
);

const ProviderCompatPropertyOverrides = {
  sendSessionAffinityHeaders: optionalCompatBoolean({
    description:
      "Whether to send session-affinity data from options.sessionId. Defaults are API-specific.",
  }),
  sessionAffinityFormat: optionalSessionAffinityFormat({
    description: "Session-affinity header format. Defaults are API-specific or auto-detected.",
  }),
  supportsDeveloperRole: optionalCompatBoolean({
    description:
      "Whether the provider supports the developer role instead of system. Defaults are API-specific.",
  }),
  supportsLongCacheRetention: optionalCompatBoolean({
    description:
      "Whether the provider supports long prompt cache retention. Defaults are API-specific or auto-detected.",
  }),
  supportsMidConvoEffort: optionalCompatBoolean({
    default: false,
    description:
      "Whether thinking level changes are sent inside the conversation instead of changing the request's effort, so a change keeps the prompt cache. Used by the anthropic-messages and openai-responses APIs.",
  }),
  supportsMidConvoSystemMessages: optionalCompatBoolean({
    default: false,
    description:
      "Whether the exact model accepts system or developer messages after the conversation has started. When false, later system messages are folded into the leading system message.",
  }),
  supportsOpenAIGrammarTools: optionalCompatBoolean({
    default: false,
    description:
      "Whether the provider supports OpenAI custom tools with Lark or regex grammar formats. When false, grammar-constrained tools fall back to normal function tools.",
  }),
  supportsStrictMode: optionalCompatBoolean({
    description: "Whether the provider supports strict tool schemas. Defaults are API-specific.",
  }),
} satisfies TProperties;

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type MergedCompatProperties<
  PropertyGroups extends readonly TProperties[],
  Overrides extends TProperties,
> = Omit<UnionToIntersection<PropertyGroups[number]>, keyof Overrides> & Overrides;

function mergeCompatProperties<
  const PropertyGroups extends readonly TProperties[],
  const Overrides extends TProperties,
>(
  propertyGroups: PropertyGroups,
  overrides: Overrides,
): MergedCompatProperties<PropertyGroups, Overrides> {
  const merged: TProperties = {};
  const duplicateNames = new Set<string>();

  for (const properties of propertyGroups) {
    for (const [name, schema] of Object.entries(properties)) {
      if (merged[name] !== undefined) {
        duplicateNames.add(name);
        if (!(name in overrides)) {
          throw new Error(`Duplicate compatibility schema property requires an override: ${name}`);
        }
      }
      merged[name] = schema;
    }
  }

  for (const name of Object.keys(overrides)) {
    if (!duplicateNames.has(name)) {
      throw new Error(
        `Compatibility schema override does not resolve a duplicate property: ${name}`,
      );
    }
  }

  return { ...merged, ...overrides } as MergedCompatProperties<PropertyGroups, Overrides>;
}

const CompatSchemasByApi = {
  "anthropic-messages": AnthropicMessagesCompatSchema,
  "openai-completions": OpenAICompletionsCompatSchema,
  "openai-responses": OpenAIResponsesCompatSchema,
} as const;

const ProviderCompatProperties = mergeCompatProperties(
  Object.values(CompatSchemasByApi).map((schema) => schema.properties),
  ProviderCompatPropertyOverrides,
);

const ProviderCompatSchema = Type.Object(ProviderCompatProperties, {
  additionalProperties: true,
  description: "Provider and model compatibility overrides.",
});

const compatSchema = {
  AnthropicMessagesCompatSchema,
  ProviderCompatSchema,
};

export default compatSchema;
