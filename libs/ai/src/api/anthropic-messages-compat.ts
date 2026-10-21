import type {
  BetaTool,
  BetaCacheControlEphemeral as CacheControlEphemeral,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import providerEnv from "../utils/provider-env.ts";
import type anthropicMessagesCompatTypes from "./anthropic-messages-compat.types.ts";

const { getProviderEnvValue } = providerEnv;

const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MID_CONVERSATION_OUTPUT_CONFIG_BETA = "mid-conversation-output-config-2026-07-01";
const THINKING_BINDING_CONTROLS_BETA = "thinking-binding-controls-2026-08-01";
const INLINE_TOOLS_BETA = "inline-tools-2026-09-15";

const DEFERRED_TOOL_PLACEHOLDER: BetaTool = {
  defer_loading: true,
  description: "Reserved placeholder. Never available. Never call this.",
  input_schema: { properties: {}, required: [], type: "object" },
  name: "__pi_deferred_placeholder__",
};

function shouldUseServerSideFallbackBeta(model: typesModule.Model<"anthropic-messages">): boolean {
  return (model.compat?.allowedFallbackModels?.length ?? 0) > 0;
}

function getAnthropicCompat(model: typesModule.Model<"anthropic-messages">) {
  const isOpenRouter = model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai");
  return {
    allowEmptySignature: model.compat?.allowEmptySignature ?? false,
    sendSessionAffinityHeaders: model.compat?.sendSessionAffinityHeaders ?? isOpenRouter,
    sessionAffinityFormat:
      model.compat?.sessionAffinityFormat ?? (isOpenRouter ? "openrouter" : undefined),
    supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? true,
    supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? true,
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    supportsMidConvoToolChanges: model.compat?.supportsMidConvoToolChanges ?? false,
    supportsStrictTools: model.compat?.supportsStrictTools ?? false,
    supportsTemperature: model.compat?.supportsTemperature ?? true,
  };
}
function resolveCacheRetention(
  input: anthropicMessagesCompatTypes.CacheRetentionInput,
): typesModule.CacheRetention {
  const { cacheRetention, env } = input;
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  if (getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long") {
    return "long";
  }
  return "short";
}
function getCacheControl(input: anthropicMessagesCompatTypes.CacheControlInput): {
  retention: typesModule.CacheRetention;
  cacheControl?: CacheControlEphemeral;
} {
  const { model } = input;
  const retention = resolveCacheRetention(input);
  if (retention === "none") {
    return { retention };
  }
  const ttl =
    retention === "long" && getAnthropicCompat(model).supportsLongCacheRetention ? "1h" : undefined;
  return {
    cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
    retention,
  };
}

function isAnthropicEffort(value: unknown): value is anthropicMessagesCompatTypes.AnthropicEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}
function mapThinkingLevelToEffort(
  input: anthropicMessagesCompatTypes.ThinkingLevelInput,
): anthropicMessagesCompatTypes.AnthropicEffort {
  const { model, level } = input;
  const mapped = level === undefined ? undefined : model.thinkingLevelMap?.[level];
  if (typeof mapped === "string") return mapped as anthropicMessagesCompatTypes.AnthropicEffort;

  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "high";
  }
}

const anthropicMessagesCompat = {
  DEFERRED_TOOL_PLACEHOLDER,
  FINE_GRAINED_TOOL_STREAMING_BETA,
  INLINE_TOOLS_BETA,
  INTERLEAVED_THINKING_BETA,
  MID_CONVERSATION_OUTPUT_CONFIG_BETA,
  SERVER_SIDE_FALLBACK_BETA,
  THINKING_BINDING_CONTROLS_BETA,
  getAnthropicCompat,
  getCacheControl,
  isAnthropicEffort,
  mapThinkingLevelToEffort,
  resolveCacheRetention,
  shouldUseServerSideFallbackBeta,
};

export default anthropicMessagesCompat;
