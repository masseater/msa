import type {
  BetaStopReason,
  BetaTool,
  MessageCreateParamsStreaming,
  BetaRefusalStopDetails as RefusalStopDetails,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import transcript from "../utils/transcript.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import anthropicMessagesCompat from "./anthropic-messages-compat.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";
import type anthropicMessagesToolsTypes from "./anthropic-messages-tools.types.ts";
import constrainedSamplingSchema from "./constrained-sampling-schema.ts";
import type constrainedSamplingSchemaTypes from "./constrained-sampling-schema.types.ts";

const { getJsonSchemaToolParameters, resolveJsonSchemaStrictSampling } = constrainedSamplingSchema;
const { getCurrentTools } = transcript;
const {
  FINE_GRAINED_TOOL_STREAMING_BETA,
  INLINE_TOOLS_BETA,
  INTERLEAVED_THINKING_BETA,
  MID_CONVERSATION_OUTPUT_CONFIG_BETA,
  SERVER_SIDE_FALLBACK_BETA,
  THINKING_BINDING_CONTROLS_BETA,
  getAnthropicCompat,
  shouldUseServerSideFallbackBeta,
} = anthropicMessagesCompat;

const ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "uniqueItems",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
]);
const ANTHROPIC_STRICT_STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

const isAnthropicStrictUnsupportedKeyword: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck =
  (key, value) => {
    if (ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS.has(key)) return true;
    if (key === "minItems") return value !== 0 && value !== 1;
    if (key === "format")
      return typeof value !== "string" || !ANTHROPIC_STRICT_STRING_FORMATS.has(value);
    return false;
  };

function resolveToolStrict(
  tool: typesModule.Tool,
  options: anthropicMessagesToolsTypes.ConvertToolsOptions,
): boolean | undefined {
  const config = tool.constrainedSampling;
  const isPreferred =
    config !== undefined &&
    config !== false &&
    config.type === "json_schema" &&
    config.strict === "prefer";
  if (options.disablePreferredStrictTools === true && isPreferred) return undefined;
  return resolveJsonSchemaStrictSampling(
    tool,
    options.supportsStrictTools,
    isAnthropicStrictUnsupportedKeyword,
  );
}

function toBetaTool(
  tool: typesModule.Tool,
  index: number,
  tools: ReadonlyArray<typesModule.Tool>,
  options: anthropicMessagesToolsTypes.ConvertToolsOptions,
): BetaTool {
  const strict = resolveToolStrict(tool, options);
  const parameters = getJsonSchemaToolParameters(tool, strict);
  const schema = parameters as { properties?: unknown; required?: string[] };
  const legacyInputSchema = {
    properties: schema.properties ?? {},
    required: schema.required ?? [],
    type: "object" as const,
  };
  const inputSchema =
    strict === true
      ? { ...(parameters as Record<string, unknown>), ...legacyInputSchema }
      : legacyInputSchema;

  return {
    description: tool.description,
    input_schema: inputSchema,
    name: tool.name,
    ...(options.supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
    ...(strict === true ? { strict: true } : {}),
    ...(options.cacheControl !== undefined && index === tools.length - 1
      ? { cache_control: options.cacheControl }
      : {}),
  };
}

interface ConvertToolsInput extends anthropicMessagesToolsTypes.ConvertToolsOptions {
  readonly tools: typesModule.Tool[];
}

function convertTools(input: ConvertToolsInput): BetaTool[] {
  const { tools, ...options } = input;
  if (tools === undefined) return [];
  return tools.map((tool, index) => toBetaTool(tool, index, tools, options));
}

interface MapStopReasonInput {
  readonly reason: BetaStopReason | string;
  readonly stopDetails?: RefusalStopDetails | null | undefined;
}

function mapStopReason(input: MapStopReasonInput): {
  stopReason: typesModule.StopReason;
  errorMessage?: string;
} {
  const { reason, stopDetails } = input;
  switch (reason) {
    case "end_turn":
      return { stopReason: "stop" };
    case "max_tokens":
      return { stopReason: "length" };
    case "tool_use":
      return { stopReason: "toolUse" };
    case "refusal":
      return {
        errorMessage: stopDetails?.explanation || `The model refused to complete the request`,
        stopReason: "error",
      };
    case "pause_turn":
      return { stopReason: "stop" };
    case "stop_sequence":
      return { stopReason: "stop" };
    case "sensitive":
      return { errorMessage: "Provider stopped with: sensitive", stopReason: "error" };
    default:
      throw new Error(`Unhandled stop reason: ${reason}`);
  }
}

function shouldUseFineGrainedToolStreamingBeta(
  model: typesModule.Model<"anthropic-messages">,
  context: transcriptTypes.TranscriptContext,
): boolean {
  return (
    getCurrentTools(context.messages).length > 0 &&
    !getAnthropicCompat(model).supportsEagerToolInputStreaming
  );
}

function configuredBetaFeatures(
  model: typesModule.Model<"anthropic-messages">,
  options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined,
): ReadonlyArray<string> | undefined {
  let configuredFeatures: string | null | undefined;
  for (const headers of [model.headers, options?.headers]) {
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (name.toLowerCase() === "anthropic-beta") configuredFeatures = value;
    }
  }
  if (configuredFeatures === null) return [];
  if (configuredFeatures === undefined) return undefined;
  return [
    ...new Set(
      configuredFeatures
        .split(",")
        .map((feature) => feature.trim())
        .filter((feature) => feature.length > 0),
    ),
  ];
}

interface BetaFeaturesInput {
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly context: transcriptTypes.TranscriptContext;
  readonly nativeToolChanges: boolean;
  readonly options?: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
}

function getBetaFeatures(
  input: BetaFeaturesInput,
): NonNullable<MessageCreateParamsStreaming["betas"]> {
  const { model, context, nativeToolChanges, options } = input;
  const configured = configuredBetaFeatures(model, options);
  if (configured !== undefined) return [...configured];

  const features: NonNullable<MessageCreateParamsStreaming["betas"]> = [];
  if (shouldUseFineGrainedToolStreamingBeta(model, context))
    features.push(FINE_GRAINED_TOOL_STREAMING_BETA);
  if (
    model.reasoning &&
    options?.thinkingEnabled === true &&
    (options.interleavedThinking ?? true) &&
    model.compat?.forceAdaptiveThinking !== true
  ) {
    features.push(INTERLEAVED_THINKING_BETA);
  }
  if (shouldUseServerSideFallbackBeta(model)) features.push(SERVER_SIDE_FALLBACK_BETA);
  if (model.compat?.supportsMidConvoEffort === true) {
    features.push(MID_CONVERSATION_OUTPUT_CONFIG_BETA, THINKING_BINDING_CONTROLS_BETA);
  }
  if (nativeToolChanges) features.push(INLINE_TOOLS_BETA);
  return [...new Set(features)];
}

const anthropicMessagesTools = {
  convertTools,
  getBetaFeatures,
  mapStopReason,
};

export default anthropicMessagesTools;
