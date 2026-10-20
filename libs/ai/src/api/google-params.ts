import type {
  GenerateContentConfig,
  GenerateContentParameters,
  ThinkingConfig,
} from "@google/genai";

import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import textModule from "../utils/text.ts";
import transcript from "../utils/transcript.ts";
import googleMessages from "./google-messages.ts";
import type googleParamsTypes from "./google-params.types.ts";
import googleThinking from "./google-thinking.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";
import googleTools from "./google-tools.ts";

const { getCurrentTools, getInitialSystemMessage } = transcript;
const { convertTools, resolveGoogleFunctionCallingMode, supportsGoogleStrictToolSampling } =
  googleTools;
const { getDisabledGoogleThinkingConfig, toGoogleSdkThinkingLevel } = googleThinking;
const { convertMessages } = googleMessages;
const { getSystemMessageText } = textModule;
const { sanitizeSurrogates } = sanitizeUnicode;

function generationConfig(options: googleParamsTypes.GoogleRequestOptions): GenerateContentConfig {
  const config: GenerateContentConfig = {};
  if (options.temperature !== undefined) config.temperature = options.temperature;
  if (options.maxTokens !== undefined) config.maxOutputTokens = options.maxTokens;
  return config;
}

function toolConfig<T extends googleThinkingTypes.GoogleApiType>(
  model: typesModule.Model<T>,
  context: typesModule.TranscriptContext,
  options: googleParamsTypes.GoogleRequestOptions,
): GenerateContentConfig {
  const currentTools = getCurrentTools(context.messages);
  const supportsStrictMode = supportsGoogleStrictToolSampling(model.id);
  const functionCallingMode =
    currentTools.length > 0
      ? resolveGoogleFunctionCallingMode(currentTools, options.toolChoice, supportsStrictMode)
      : undefined;
  const tools = convertTools(currentTools, false, supportsStrictMode);
  return {
    ...(tools !== undefined && { tools }),
    ...(functionCallingMode !== undefined && {
      toolConfig: { functionCallingConfig: { mode: functionCallingMode } },
    }),
  };
}

function thinkingConfig<T extends googleThinkingTypes.GoogleApiType>(
  model: typesModule.Model<T>,
  options: googleParamsTypes.GoogleRequestOptions,
): ThinkingConfig | undefined {
  const { thinking } = options;
  if (!model.reasoning || thinking === undefined) return undefined;
  if (!thinking.enabled) return getDisabledGoogleThinkingConfig(model);
  const config: ThinkingConfig = { includeThoughts: true };
  if (thinking.level !== undefined) {
    config.thinkingLevel = toGoogleSdkThinkingLevel(thinking.level);
  } else if (thinking.budgetTokens !== undefined) {
    config.thinkingBudget = thinking.budgetTokens;
  }
  return config;
}

function buildGoogleParams<T extends googleThinkingTypes.GoogleApiType>({
  model,
  context,
  options = {},
}: googleParamsTypes.GoogleParamsRequest<T>): GenerateContentParameters {
  const contents = convertMessages(model, context);
  const initialSystemMessage = getInitialSystemMessage(context.messages);
  const systemInstruction =
    initialSystemMessage === undefined ? "" : getSystemMessageText(initialSystemMessage);
  const generation = generationConfig(options);
  const config: GenerateContentConfig = {
    ...(Object.keys(generation).length > 0 && generation),
    ...(systemInstruction && { systemInstruction: sanitizeSurrogates(systemInstruction) }),
    ...toolConfig(model, context, options),
  };
  const thinking = thinkingConfig(model, options);
  if (thinking !== undefined) config.thinkingConfig = thinking;
  if (options.signal !== undefined) {
    if (options.signal.aborted) throw new Error("Request aborted");
    config.abortSignal = options.signal;
  }
  return { config, contents, model: model.id };
}

const googleParams = {
  buildGoogleParams,
};

export default googleParams;
