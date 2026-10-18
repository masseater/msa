import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { Model, TranscriptContext } from "../types.ts";
import { resolveTranscriptTools } from "../utils/transcript.ts";
import type { AzureEndpointOptions } from "./azure-openai-config.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import { convertResponsesMessages } from "./openai-responses-messages.ts";
import {
  applyReasoningParams,
  type ResponsesReasoningOptions,
} from "./openai-responses-reasoning.ts";
import { convertResponsesTools } from "./openai-responses-tools.ts";

const AZURE_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode", "azure"]);
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;

export interface AzureOpenAIResponsesOptions
  extends AzureEndpointOptions, ResponsesReasoningOptions {}

export interface AzureResponsesParamsRequest {
  readonly model: Model<"azure-openai-responses">;
  readonly context: TranscriptContext;
  readonly options: AzureOpenAIResponsesOptions | undefined;
  readonly deploymentName: string;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
}

function requestInput({
  model,
  context,
  grammarToolInputProperties,
}: AzureResponsesParamsRequest): Pick<ResponseCreateParamsStreaming, "input" | "tools"> {
  const compat = model.compat;
  const supportsAdditionalTools = compat?.supportsAdditionalTools ?? false;
  const supportsToolSearch = compat?.supportsToolSearch ?? false;
  const toolOptions = {
    supportsStrictMode: compat?.supportsStrictMode ?? true,
    supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? false,
  };
  const input = convertResponsesMessages(model, context, AZURE_TOOL_CALL_PROVIDERS, {
    grammarToolInputProperties,
    supportsMidConvoSystemMessages: compat?.supportsMidConvoSystemMessages ?? false,
    supportsAdditionalTools,
    supportsToolSearch,
    toolOptions,
  });
  const { requestTools } = resolveTranscriptTools(
    context.messages,
    supportsAdditionalTools || supportsToolSearch,
  );
  return {
    input,
    ...(requestTools.length > 0 ? { tools: convertResponsesTools(requestTools, toolOptions) } : {}),
  };
}

export function buildAzureResponsesParams(
  request: AzureResponsesParamsRequest,
): ResponseCreateParamsStreaming {
  const { model, options, deploymentName } = request;
  const promptCacheKey = clampOpenAIPromptCacheKey(options?.sessionId);
  const maxTokens = options?.maxTokens;
  const params: ResponseCreateParamsStreaming = {
    model: deploymentName,
    ...requestInput(request),
    stream: true,
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    store: false,
    ...(maxTokens !== undefined && maxTokens !== 0 && !Number.isNaN(maxTokens)
      ? { max_output_tokens: Math.max(maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS) }
      : {}),
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options?.toolChoice === undefined ? {} : { tool_choice: options.toolChoice }),
  };
  applyReasoningParams(params)({ model, options });
  return params;
}
