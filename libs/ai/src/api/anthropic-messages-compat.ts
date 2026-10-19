import type {
  BetaCacheControlEphemeral as CacheControlEphemeral,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type { CacheRetention, Model, ProviderEnv, SimpleStreamOptions } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicThinkingDisplay = "summarized" | "omitted";

const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MID_CONVERSATION_OUTPUT_CONFIG_BETA = "mid-conversation-output-config-2026-07-01";
const THINKING_BINDING_CONTROLS_BETA = "thinking-binding-controls-2026-08-01";
const INLINE_TOOLS_BETA = "inline-tools-2026-09-15";

const DEFERRED_TOOL_PLACEHOLDER: BetaTool = {
  name: "__pi_deferred_placeholder__",
  description: "Reserved placeholder. Never available. Never call this.",
  input_schema: { type: "object", properties: {}, required: [] },
  defer_loading: true,
};

function shouldUseServerSideFallbackBeta(model: Model<"anthropic-messages">): boolean {
  return (model.compat?.allowedFallbackModels?.length ?? 0) > 0;
}

function getAnthropicCompat(model: Model<"anthropic-messages">) {
  const isOpenRouter = model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai");
  return {
    supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? true,
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    sendSessionAffinityHeaders: model.compat?.sendSessionAffinityHeaders ?? isOpenRouter,
    sessionAffinityFormat:
      model.compat?.sessionAffinityFormat ?? (isOpenRouter ? "openrouter" : undefined),
    supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? true,
    supportsTemperature: model.compat?.supportsTemperature ?? true,
    allowEmptySignature: model.compat?.allowEmptySignature ?? false,
    supportsStrictTools: model.compat?.supportsStrictTools ?? false,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    supportsMidConvoToolChanges: model.compat?.supportsMidConvoToolChanges ?? false,
  };
}

interface CacheRetentionInput {
  readonly cacheRetention?: CacheRetention | undefined;
  readonly env?: ProviderEnv | undefined;
}

function resolveCacheRetention(input: CacheRetentionInput): CacheRetention {
  const { cacheRetention, env } = input;
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  if (getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long") {
    return "long";
  }
  return "short";
}

interface CacheControlInput extends CacheRetentionInput {
  readonly model: Model<"anthropic-messages">;
}

function getCacheControl(input: CacheControlInput): {
  retention: CacheRetention;
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
    retention,
    cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
  };
}

function isAnthropicEffort(value: unknown): value is AnthropicEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

interface ThinkingLevelInput {
  readonly model: Model<"anthropic-messages">;
  readonly level: SimpleStreamOptions["reasoning"];
}

function mapThinkingLevelToEffort(input: ThinkingLevelInput): AnthropicEffort {
  const { model, level } = input;
  const mapped = level === undefined ? undefined : model.thinkingLevelMap?.[level];
  if (typeof mapped === "string") return mapped as AnthropicEffort;

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

export {
  DEFERRED_TOOL_PLACEHOLDER,
  FINE_GRAINED_TOOL_STREAMING_BETA,
  getAnthropicCompat,
  getCacheControl,
  INLINE_TOOLS_BETA,
  INTERLEAVED_THINKING_BETA,
  isAnthropicEffort,
  mapThinkingLevelToEffort,
  MID_CONVERSATION_OUTPUT_CONFIG_BETA,
  resolveCacheRetention,
  SERVER_SIDE_FALLBACK_BETA,
  shouldUseServerSideFallbackBeta,
  THINKING_BINDING_CONTROLS_BETA,
};
