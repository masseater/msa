import type {
  Api,
  Model,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "../../src/types.ts";
import { mergeAnthropicMessagesCompat } from "./anthropic-metadata.ts";

const OPENAI_TOOL_SEARCH_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);

const OPENAI_ADDITIONAL_TOOLS_MODEL_IDS = OPENAI_TOOL_SEARCH_MODEL_IDS;

const OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS = OPENAI_TOOL_SEARCH_MODEL_IDS;

const OPENAI_CODEX_ADDITIONAL_TOOLS_MODEL_IDS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);

const OPENAI_MID_CONVO_EFFORT_MODEL_IDS = new Set([
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);

export function applyStrictToolCompatMetadata(model: Model<Api>): void {
  if (model.provider === "openai" && model.api === "openai-responses") {
    model.compat = {
      ...(model.compat as OpenAIResponsesCompat | undefined),
      supportsStrictMode: true,
    };
  } else if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    mergeAnthropicMessagesCompat(model, { supportsStrictTools: true });
  }
}

const OPENAI_GRAMMAR_TOOL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

const OPENAI_GRAMMAR_TOOL_APIS = new Set<Api>(["openai-responses", "openai-codex-responses"]);

export function applyOpenAIGrammarToolCompatMetadata(model: Model<Api>): void {
  if (
    !OPENAI_GRAMMAR_TOOL_APIS.has(model.api) ||
    !OPENAI_GRAMMAR_TOOL_PROVIDERS.has(model.provider)
  )
    return;
  const match = /^gpt-(\d+)/u.exec(model.id);
  if (match === null || Number(match[1]) < 5) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsOpenAIGrammarTools: true,
  };
}

export function applyOpenAIToolSearchMetadata(model: Model<Api>): void {
  const isOpenAIResponses = model.provider === "openai" && model.api === "openai-responses";
  const isOpenAICodex = model.provider === "openai-codex" && model.api === "openai-codex-responses";
  if (!(isOpenAIResponses || isOpenAICodex) || !OPENAI_TOOL_SEARCH_MODEL_IDS.has(model.id)) return;
  const supportsAdditionalTools =
    (isOpenAIResponses && OPENAI_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id)) ||
    (isOpenAICodex && OPENAI_CODEX_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id));
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    ...(supportsAdditionalTools ? { supportsAdditionalTools: true } : {}),
    supportsToolSearch: true,
  };
}

export function applyOpenAICompletionsTranscriptMetadata(model: Model<Api>): void {
  if (model.api !== "openai-completions") return;
  const isKimiK3 =
    (model.provider === "opencode" || model.provider === "opencode-go") && model.id === "kimi-k3";
  const isTextOnly =
    model.provider === "openrouter" &&
    model.id.startsWith("openai/") &&
    OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id.slice("openai/".length));
  if (!isKimiK3 && !isTextOnly) return;
  model.compat = {
    ...(model.compat as OpenAICompletionsCompat | undefined),
    supportsMidConvoSystemMessages: true,
    ...(isKimiK3 ? { supportsMidConvoToolAdditions: true } : {}),
  };
}

const OPENAI_RESPONSES_PROXY_PROVIDERS = new Set(["opencode", "opencode-go"]);

export function applyOpenAIResponsesTranscriptMetadata(model: Model<Api>): void {
  const isOpenAIResponses = model.provider === "openai" && model.api === "openai-responses";
  const isOpenAICodex = model.provider === "openai-codex" && model.api === "openai-codex-responses";
  const isProxiedResponses =
    OPENAI_RESPONSES_PROXY_PROVIDERS.has(model.provider) && model.api === "openai-responses";
  if (
    !(isOpenAIResponses || isOpenAICodex || isProxiedResponses) ||
    !OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id)
  ) {
    return;
  }
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsMidConvoSystemMessages: true,
    ...(isProxiedResponses ? { supportsAdditionalTools: true } : {}),
  };
}

export function applyOpenAIExplicitPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!(model.cost.cacheWrite > 0)) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsExplicitPromptCacheMode: true,
  };
}

export function applyOpenAIMidConvoEffortMetadata(model: Model<Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!OPENAI_MID_CONVO_EFFORT_MODEL_IDS.has(model.id)) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsMidConvoEffort: true,
  };
}
