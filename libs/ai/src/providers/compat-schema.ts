import { type Static, type TProperties, Type } from "typebox";

import { optionalCompatBoolean, optionalSessionAffinityFormat } from "./compat-fields-schema.ts";
import {
  OpenAICompletionsCompatSchema,
  OpenAIResponsesCompatSchema,
} from "./openai-compat-schema.ts";
import { AnthropicAllowedFallbackModelSchema } from "./routing-schema.ts";

export const AnthropicMessagesCompatSchema = Type.Object(
  {
    supportsEagerToolInputStreaming: Type.Optional(
      Type.Boolean({
        description:
          "Whether the provider accepts per-tool eager_input_streaming. When false, the Anthropic provider omits tools[].eager_input_streaming and sends the legacy fine-grained-tool-streaming-2025-05-14 beta header for tool-enabled requests.",
        default: true,
      }),
    ),
    supportsLongCacheRetention: optionalCompatBoolean({
      description:
        "Whether the provider supports Anthropic long cache retention through cache_control.ttl.",
      default: true,
    }),
    sendSessionAffinityHeaders: optionalCompatBoolean({
      description:
        "Whether to send x-session-affinity from options.sessionId when caching is enabled. Required for providers like Fireworks that use session affinity for prompt cache routing; requests to the same replica maximize cache hits. Default: true for OpenRouter endpoints, false otherwise.",
    }),
    sessionAffinityFormat: Type.Optional(
      Type.Literal("openrouter", {
        description:
          "Session-affinity format. openrouter sends x-session-id; when unset, sends x-session-affinity.",
      }),
    ),
    supportsCacheControlOnTools: Type.Optional(
      Type.Boolean({
        description:
          "Whether the provider supports Anthropic-style cache_control markers on tool definitions. When false, cache_control is omitted from tool parameters. Some Anthropic-compatible providers, such as Fireworks, do not support this field on tools and may reject or ignore it.",
        default: true,
      }),
    ),
    supportsTemperature: Type.Optional(
      Type.Boolean({
        description:
          "Whether the model accepts the Anthropic temperature request field. Claude Opus 4.7+ rejects non-default values.",
        default: true,
      }),
    ),
    forceAdaptiveThinking: Type.Optional(
      Type.Boolean({
        description:
          "Whether to force adaptive thinking (thinking.type: adaptive plus output_config.effort) regardless of model ID. Built-in models that require adaptive thinking set this in generated metadata. Custom Anthropic-compatible providers can set this to true for any model whose upstream requires the adaptive format. Set false to opt out on overridden built-in models.",
        default: false,
      }),
    ),
    allowEmptySignature: Type.Optional(
      Type.Boolean({
        description:
          "Whether to replay empty thinking signatures instead of converting thinking to text.",
        default: false,
      }),
    ),
    supportsStrictTools: Type.Optional(
      Type.Boolean({
        description:
          "Whether the provider supports Anthropic strict tool schemas. Generated Anthropic models enable it explicitly.",
        default: false,
      }),
    ),
    supportsMidConvoEffort: Type.Optional(
      Type.Boolean({
        description:
          "Whether the exact model transport supports effort-only system messages and thinking binding controls.",
        default: false,
      }),
    ),
    supportsMidConvoSystemMessages: optionalCompatBoolean({
      description:
        "Whether the exact model accepts system-role messages inside the conversation. When false, later system messages are folded into the top-level system prompt.",
      default: false,
    }),
    supportsMidConvoToolChanges: Type.Optional(
      Type.Boolean({
        description:
          "Whether the exact model accepts mid-conversation tool_addition and tool_removal blocks. Requires supportsMidConvoSystemMessages.",
        default: false,
      }),
    ),
    allowedFallbackModels: Type.Optional(
      Type.Array(AnthropicAllowedFallbackModelSchema, {
        maxItems: 3,
        description:
          "Models Anthropic accepts for server-side refusal fallback, with local pricing metadata for returned fallback responses. When absent or empty, callers must omit fallbacks; Anthropic rejects the field for models with no permitted fallback targets.",
      }),
    ),
  },
  {
    description: "Compatibility settings for Anthropic Messages-compatible APIs.",
    additionalProperties: true,
  },
);

export const BedrockCompatSchema = Type.Object(
  {
    supportsStrictMode: optionalCompatBoolean({
      description: "Whether the model supports Bedrock strict tool schemas.",
      default: false,
    }),
  },
  { description: "Compatibility settings for Amazon Bedrock models.", additionalProperties: true },
);

export const MistralConversationsCompatSchema = Type.Object(
  {
    supportsMidConvoSystemMessages: optionalCompatBoolean({
      description:
        "Whether the exact model accepts system messages after the conversation has started. When false, later system messages are folded into the leading system message.",
      default: false,
    }),
  },
  { description: "Compatibility settings for the Mistral chat API.", additionalProperties: true },
);

const ProviderCompatPropertyOverrides = {
  supportsDeveloperRole: optionalCompatBoolean({
    description:
      "Whether the provider supports the developer role instead of system. Defaults are API-specific.",
  }),
  supportsMidConvoSystemMessages: optionalCompatBoolean({
    description:
      "Whether the exact model accepts system or developer messages after the conversation has started. When false, later system messages are folded into the leading system message.",
    default: false,
  }),
  sessionAffinityFormat: optionalSessionAffinityFormat({
    description: "Session-affinity header format. Defaults are API-specific or auto-detected.",
  }),
  supportsMidConvoEffort: optionalCompatBoolean({
    description:
      "Whether thinking level changes are sent inside the conversation instead of changing the request's effort, so a change keeps the prompt cache. Used by the anthropic-messages and openai-responses APIs.",
    default: false,
  }),
  supportsLongCacheRetention: optionalCompatBoolean({
    description:
      "Whether the provider supports long prompt cache retention. Defaults are API-specific or auto-detected.",
  }),
  supportsStrictMode: optionalCompatBoolean({
    description: "Whether the provider supports strict tool schemas. Defaults are API-specific.",
  }),
  supportsOpenAIGrammarTools: optionalCompatBoolean({
    description:
      "Whether the provider supports OpenAI custom tools with Lark or regex grammar formats. When false, grammar-constrained tools fall back to normal function tools.",
    default: false,
  }),
  sendSessionAffinityHeaders: optionalCompatBoolean({
    description:
      "Whether to send session-affinity data from options.sessionId. Defaults are API-specific.",
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
  "openai-completions": OpenAICompletionsCompatSchema,
  "openai-responses": OpenAIResponsesCompatSchema,
  "anthropic-messages": AnthropicMessagesCompatSchema,
  "bedrock-converse-stream": BedrockCompatSchema,
  "mistral-conversations": MistralConversationsCompatSchema,
} as const;

const ProviderCompatProperties = mergeCompatProperties(
  Object.values(CompatSchemasByApi).map((schema) => schema.properties),
  ProviderCompatPropertyOverrides,
);

export const ProviderCompatSchema = Type.Object(ProviderCompatProperties, {
  description: "Provider and model compatibility overrides.",
  additionalProperties: true,
});

export interface AnthropicMessagesCompat extends Static<typeof AnthropicMessagesCompatSchema> {}
export interface BedrockCompat extends Static<typeof BedrockCompatSchema> {}
export interface MistralConversationsCompat extends Static<
  typeof MistralConversationsCompatSchema
> {}
