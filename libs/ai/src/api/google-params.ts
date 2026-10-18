import type {
  GenerateContentConfig,
  GenerateContentParameters,
  ThinkingConfig,
} from "@google/genai";

import type { Model, StreamOptions, TranscriptContext } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText } from "../utils/text.ts";
import { getCurrentTools, getInitialSystemMessage } from "../utils/transcript.ts";
import { convertMessages } from "./google-messages.ts";
import {
  type GoogleApiThinkingLevel,
  type GoogleApiType,
  getDisabledGoogleThinkingConfig,
  toGoogleSdkThinkingLevel,
} from "./google-thinking.ts";
import {
  convertTools,
  resolveGoogleFunctionCallingMode,
  supportsGoogleStrictToolSampling,
} from "./google-tools.ts";

export interface GoogleRequestOptions extends StreamOptions {
  toolChoice?: "auto" | "none" | "any" | undefined;
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
    level?: GoogleApiThinkingLevel;
  };
}

function generationConfig(options: GoogleRequestOptions): GenerateContentConfig {
  const config: GenerateContentConfig = {};
  if (options.temperature !== undefined) config.temperature = options.temperature;
  if (options.maxTokens !== undefined) config.maxOutputTokens = options.maxTokens;
  return config;
}

function toolConfig<T extends GoogleApiType>(
  model: Model<T>,
  context: TranscriptContext,
  options: GoogleRequestOptions,
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

function thinkingConfig<T extends GoogleApiType>(
  model: Model<T>,
  options: GoogleRequestOptions,
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

export interface GoogleParamsRequest<T extends GoogleApiType> {
  readonly model: Model<T>;
  readonly context: TranscriptContext;
  readonly options: GoogleRequestOptions | undefined;
}

export function buildGoogleParams<T extends GoogleApiType>({
  model,
  context,
  options = {},
}: GoogleParamsRequest<T>): GenerateContentParameters {
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
  return { model: model.id, contents, config };
}
