import { Type } from "typebox";

import compatFieldsSchema from "./compat-fields-schema.ts";
import routingSchema from "./routing-schema.ts";

const {
  ChatTemplateKwargValueSchema,
  optionalCompatBoolean,
  optionalSessionAffinityFormat,
  thinkingTokenBudgetField,
} = compatFieldsSchema;
const { OpenRouterRoutingSchema } = routingSchema;

const OpenAICompletionsCompatSchema = Type.Object(
  {
    cacheControlFormat: Type.Optional(
      Type.Literal("anthropic", {
        description:
          "Cache control convention for prompt caching. Anthropic applies cache_control markers to the system prompt, last tool definition, and last user, assistant, or tool-result text content.",
      }),
    ),
    chatTemplateKwargs: Type.Optional(
      Type.Record(Type.String(), ChatTemplateKwargValueSchema, {
        description:
          'Kwargs sent as chat_template_kwargs when thinkingFormat is "chat-template". Use $var with "thinking.enabled", "thinking.effort", or "thinking.budget" for msa-controlled values.',
      }),
    ),
    maxTokensField: Type.Optional(
      Type.Union([Type.Literal("max_completion_tokens"), Type.Literal("max_tokens")], {
        description: "Which field to use for max tokens. Default: auto-detected from URL.",
      }),
    ),
    openRouterRouting: Type.Optional(OpenRouterRoutingSchema),
    requiresAssistantAfterToolResult: Type.Optional(
      Type.Boolean({
        description:
          "Whether a user message after tool results requires an assistant message in between. Default: auto-detected from URL.",
      }),
    ),
    requiresReasoningContentOnAssistantMessages: Type.Optional(
      Type.Boolean({
        description:
          "Whether all replayed assistant messages must include an empty reasoning_content field when reasoning is enabled. Default: auto-detected from URL.",
      }),
    ),
    requiresThinkingAsText: Type.Optional(
      Type.Boolean({
        description:
          "Whether thinking blocks must be converted to text blocks with <thinking> delimiters. Default: auto-detected from URL.",
      }),
    ),
    requiresToolResultName: Type.Optional(
      Type.Boolean({
        description:
          "Whether tool results require the name field. Default: auto-detected from URL.",
      }),
    ),
    sendSessionAffinityHeaders: optionalCompatBoolean({
      description:
        "Whether to send session-affinity data from options.sessionId. Default: true for OpenRouter endpoints, false otherwise.",
    }),
    sessionAffinityFormat: optionalSessionAffinityFormat({
      description:
        "Session-affinity header format. openai sends session_id, x-client-request-id, and x-session-affinity; openai-nosession sends x-client-request-id and x-session-affinity; openrouter sends x-session-id. Does not affect prompt_cache_key. Default: auto-detected.",
    }),
    supportsDeveloperRole: optionalCompatBoolean({
      description:
        "Whether the provider supports the developer role instead of system. Default: auto-detected from URL.",
    }),
    supportsFinishReason: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Whether streamed responses include finish_reason. When false, msa infers stop or toolUse when the stream ends.",
      }),
    ),
    supportsLongCacheRetention: optionalCompatBoolean({
      description:
        'Whether the provider supports long prompt cache retention (prompt_cache_retention: "24h" or Anthropic-style cache_control.ttl: "1h", depending on format). Default: auto-detected from provider and URL.',
    }),
    supportsMidConvoSystemMessages: optionalCompatBoolean({
      default: false,
      description:
        "Whether the exact model accepts system or developer messages after the conversation has started. When false, later system messages are folded into the leading system message. The generated catalog enables this for verified models.",
    }),
    supportsMidConvoToolAdditions: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether system messages can introduce additional tools mid-conversation. Requires supportsMidConvoSystemMessages. The generated catalog enables this for capable models.",
      }),
    ),
    supportsOpenAIGrammarTools: optionalCompatBoolean({
      default: false,
      description:
        "Whether the provider supports OpenAI custom tools with Lark or regex grammar formats. When false, grammar-constrained tools fall back to normal function tools. The generated catalog enables this for capable models.",
    }),
    supportsReasoningEffort: Type.Optional(
      Type.Boolean({
        description:
          "Whether the provider supports reasoning_effort. Default: auto-detected from URL.",
      }),
    ),
    supportsStore: Type.Optional(
      Type.Boolean({
        description:
          "Whether the provider supports the store field. Default: auto-detected from URL.",
      }),
    ),
    supportsStrictMode: optionalCompatBoolean({
      default: false,
      description:
        "Whether the provider supports the strict field in tool definitions. Generated capable models enable it explicitly.",
    }),
    supportsThinkingTokenBudget: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          'Alias for thinkingTokenBudgetField: "thinking_token_budget" (vLLM). Prefer thinkingTokenBudgetField.',
      }),
    ),
    supportsUsageInStreaming: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Whether the provider supports stream_options.include_usage for token usage in streaming responses.",
      }),
    ),
    thinkingFormat: Type.Optional(
      Type.Union(
        [
          Type.Literal("openai"),
          Type.Literal("openrouter"),
          Type.Literal("deepseek"),
          Type.Literal("qwen"),
          Type.Literal("chat-template"),
          Type.Literal("qwen-chat-template"),
          Type.Literal("string-thinking"),
        ],
        {
          description:
            'Format for reasoning or thinking parameters. When omitted, msa auto-detects the format from the provider URL. "openai" uses reasoning_effort, "openrouter" uses reasoning.effort, "deepseek" uses thinking.type plus reasoning_effort when supported, "qwen" uses top-level enable_thinking, "qwen-chat-template" uses chat_template_kwargs.enable_thinking and preserve_thinking, "chat-template" uses configurable chat_template_kwargs, and "string-thinking" uses top-level thinking.',
        },
      ),
    ),
    thinkingTokenBudgetField: Type.Optional(
      thinkingTokenBudgetField({
        description:
          'Top-level request field used to cap reasoning tokens from thinkingBudgets. Reasoning and the answer share max_tokens on these endpoints. "thinking_token_budget" is vLLM, "thinking_budget" is Qwen, DashScope, or SGLang, and "thinking_budget_tokens" is llama.cpp. Off by default and not set on the generated catalog.',
      }),
    ),
    vllmPriority: Type.Optional(
      Type.Number({
        description:
          "vLLM scheduler priority sent as the top-level priority request field. Lower values are handled earlier and the server default is 0. Only meaningful with --scheduling-policy priority. Off by default and not set on the generated catalog.",
      }),
    ),
  },
  {
    additionalProperties: true,
    description:
      "Compatibility settings for OpenAI-compatible completions APIs. Use this to override URL-based auto-detection for custom providers.",
  },
);

const OpenAIResponsesCompatSchema = Type.Object(
  {
    sessionAffinityFormat: optionalSessionAffinityFormat({
      description:
        "Session-affinity header format. openai sends session_id and x-client-request-id; openai-nosession sends x-client-request-id; openrouter sends x-session-id. Does not affect prompt_cache_key. Default: auto-detected.",
    }),
    supportsAdditionalTools: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Whether the model supports message-anchored additional_tools input items.",
      }),
    ),
    supportsDeveloperRole: optionalCompatBoolean({
      default: true,
      description: "Whether the provider supports the developer role instead of system.",
    }),
    supportsExplicitPromptCacheMode: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether the model accepts prompt_cache_options. Older OpenAI models reject the parameter.",
      }),
    ),
    supportsLongCacheRetention: optionalCompatBoolean({
      default: true,
      description:
        'Whether the provider supports long prompt cache retention. This uses prompt_cache_options.ttl: "30m" on GPT-5.6+ and prompt_cache_retention: "24h" on earlier models.',
    }),
    supportsMaxOutputTokens: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Whether the provider accepts max_output_tokens. Some Codex-protocol gateways reject it.",
      }),
    ),
    supportsMidConvoEffort: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether thinking level changes are sent as configuration_update input items instead of changing reasoning.effort, so a change keeps the prompt cache. Only used by the openai-responses API, and ignored with Sign in with ChatGPT on the openai provider.",
      }),
    ),
    supportsMidConvoSystemMessages: optionalCompatBoolean({
      default: false,
      description:
        "Whether the exact model accepts developer or system messages after the conversation has started. When false, later system messages are folded into the leading system message. The generated catalog enables this for verified models.",
    }),
    supportsOpenAIGrammarTools: optionalCompatBoolean({
      default: false,
      description:
        "Whether to emit OpenAI custom tools with Lark or regex grammar formats. When false, grammar-constrained tools fall back to normal function tools. The generated catalog enables this for capable models.",
    }),
    supportsStrictMode: optionalCompatBoolean({
      description:
        "Whether the provider supports strict JSON-schema function tools. Defaults are API-specific; generated OpenAI models enable it explicitly.",
    }),
    supportsToolSearch: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Whether the model supports client-executed tool search for transcript-anchored additions.",
      }),
    ),
  },
  { additionalProperties: true, description: "Compatibility settings for OpenAI Responses APIs." },
);

const openaiCompatSchema = {
  OpenAICompletionsCompatSchema,
  OpenAIResponsesCompatSchema,
};

export default openaiCompatSchema;
