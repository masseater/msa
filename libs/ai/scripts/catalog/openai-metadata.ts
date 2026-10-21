import type typesModule from "../../src/types.types.ts";
import anthropicMetadata from "./anthropic-metadata.ts";

const { mergeAnthropicMessagesCompat } = anthropicMetadata;

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

function applyStrictToolCompatMetadata(model: typesModule.Model<typesModule.Api>): void {
  if (model.provider === "openai" && model.api === "openai-responses") {
    model.compat = {
      ...(model.compat as typesModule.OpenAIResponsesCompat | undefined),
      supportsStrictMode: true,
    };
  } else if (model.provider === "anthropic-api" && model.api === "anthropic-messages") {
    mergeAnthropicMessagesCompat(model, { supportsStrictTools: true });
  }
}

const OPENAI_GRAMMAR_TOOL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

const OPENAI_GRAMMAR_TOOL_APIS = new Set<typesModule.Api>([
  "openai-responses",
  "openai-codex-responses",
]);

function applyOpenAIGrammarToolCompatMetadata(model: typesModule.Model<typesModule.Api>): void {
  if (
    !OPENAI_GRAMMAR_TOOL_APIS.has(model.api) ||
    !OPENAI_GRAMMAR_TOOL_PROVIDERS.has(model.provider)
  )
    return;
  const match = /^gpt-(\d+)/u.exec(model.id);
  if (match === null || Number(match[1]) < 5) return;
  model.compat = {
    ...(model.compat as typesModule.OpenAIResponsesCompat | undefined),
    supportsOpenAIGrammarTools: true,
  };
}

function applyOpenAIToolSearchMetadata(model: typesModule.Model<typesModule.Api>): void {
  const isOpenAIResponses = model.provider === "openai" && model.api === "openai-responses";
  const isOpenAICodex = model.provider === "openai-codex" && model.api === "openai-codex-responses";
  if (!(isOpenAIResponses || isOpenAICodex) || !OPENAI_TOOL_SEARCH_MODEL_IDS.has(model.id)) return;
  const supportsAdditionalTools =
    (isOpenAIResponses && OPENAI_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id)) ||
    (isOpenAICodex && OPENAI_CODEX_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id));
  model.compat = {
    ...(model.compat as typesModule.OpenAIResponsesCompat | undefined),
    ...(supportsAdditionalTools ? { supportsAdditionalTools: true } : {}),
    supportsToolSearch: true,
  };
}

function applyOpenAICompletionsTranscriptMetadata(model: typesModule.Model<typesModule.Api>): void {
  if (model.api !== "openai-completions") return;
  const isKimiK3 =
    (model.provider === "opencode" || model.provider === "opencode-go") && model.id === "kimi-k3";
  const isTextOnly =
    model.provider === "openrouter" &&
    model.id.startsWith("openai/") &&
    OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id.slice("openai/".length));
  if (!isKimiK3 && !isTextOnly) return;
  model.compat = {
    ...(model.compat as typesModule.OpenAICompletionsCompat | undefined),
    supportsMidConvoSystemMessages: true,
    ...(isKimiK3 ? { supportsMidConvoToolAdditions: true } : {}),
  };
}

const OPENAI_RESPONSES_PROXY_PROVIDERS = new Set(["opencode", "opencode-go"]);

function applyOpenAIResponsesTranscriptMetadata(model: typesModule.Model<typesModule.Api>): void {
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
    ...(model.compat as typesModule.OpenAIResponsesCompat | undefined),
    supportsMidConvoSystemMessages: true,
    ...(isProxiedResponses ? { supportsAdditionalTools: true } : {}),
  };
}

function applyOpenAIExplicitPromptCacheMetadata(model: typesModule.Model<typesModule.Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!(model.cost.cacheWrite > 0)) return;
  model.compat = {
    ...(model.compat as typesModule.OpenAIResponsesCompat | undefined),
    supportsExplicitPromptCacheMode: true,
  };
}

function applyOpenAIMidConvoEffortMetadata(model: typesModule.Model<typesModule.Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!OPENAI_MID_CONVO_EFFORT_MODEL_IDS.has(model.id)) return;
  model.compat = {
    ...(model.compat as typesModule.OpenAIResponsesCompat | undefined),
    supportsMidConvoEffort: true,
  };
}

const openaiMetadata = {
  applyOpenAICompletionsTranscriptMetadata,
  applyOpenAIExplicitPromptCacheMetadata,
  applyOpenAIGrammarToolCompatMetadata,
  applyOpenAIMidConvoEffortMetadata,
  applyOpenAIResponsesTranscriptMetadata,
  applyOpenAIToolSearchMetadata,
  applyStrictToolCompatMetadata,
};

export default openaiMetadata;
