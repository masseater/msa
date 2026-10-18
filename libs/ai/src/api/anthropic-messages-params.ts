import type {
  BetaCacheControlEphemeral as CacheControlEphemeral,
  BetaTool,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type { Message, Model, Tool } from "../types.ts";
import { getSystemMessageText } from "../utils/text.ts";
import {
  getCurrentTools,
  getInitialSystemMessage,
  type TranscriptContext,
} from "../utils/transcript.ts";
import {
  DEFERRED_TOOL_PLACEHOLDER,
  getAnthropicCompat,
  getCacheControl,
  type AnthropicEffort,
} from "./anthropic-messages-compat.ts";
import {
  convertMessages,
  insertThinkingLevelMessages,
  normalizeToolCallId,
  type ConvertedAnthropicMessages,
} from "./anthropic-messages-convert.ts";
import type { AnthropicOptions } from "./anthropic-messages-options.ts";
import { applyParamsOptions, buildSystem } from "./anthropic-messages-params-options.ts";
import { convertTools, getBetaFeatures } from "./anthropic-messages-tools.ts";
import { transformMessages } from "./transform-messages.ts";

type AnthropicCompat = ReturnType<typeof getAnthropicCompat>;

interface BuildParamsState {
  readonly model: Model<"anthropic-messages">;
  readonly context: TranscriptContext;
  readonly usesOAuth: boolean;
  readonly options: AnthropicOptions | undefined;
  readonly compat: AnthropicCompat;
  readonly cacheControl: CacheControlEphemeral | undefined;
  readonly initialSystemText: string;
  readonly initialTools: ReadonlyArray<Tool>;
  readonly nativeToolChanges: boolean;
  readonly thinkingDisabled: boolean;
  readonly effortMessages: boolean;
  readonly activeEffort: AnthropicEffort;
  readonly disablePreferredStrictTools: boolean;
  hasPreferredStrictTools: boolean;
}

function convertToolDefinitions(
  state: BuildParamsState,
  tools: Tool[],
  toolCacheControl?: CacheControlEphemeral,
): BetaTool[] {
  const definitions = convertTools({
    tools,
    usesOAuth: state.usesOAuth,
    supportsEagerToolInputStreaming: state.compat.supportsEagerToolInputStreaming,
    supportsStrictTools: state.compat.supportsStrictTools,
    cacheControl: toolCacheControl,
    disablePreferredStrictTools: state.disablePreferredStrictTools,
  });
  const hasPreferred = definitions.some((definition, index) => {
    const config = tools[index]?.constrainedSampling;
    return (
      definition.strict === true &&
      config !== undefined &&
      config !== false &&
      config.type === "json_schema" &&
      config.strict === "prefer"
    );
  });
  if (hasPreferred) state.hasPreferredStrictTools = true;
  return definitions;
}

function shouldSendTemperature(state: BuildParamsState): boolean {
  return (
    state.options?.temperature !== undefined &&
    state.options.thinkingEnabled !== true &&
    state.model.compat?.supportsMidConvoEffort !== true &&
    state.compat.supportsTemperature
  );
}

function applyTools(state: BuildParamsState, params: MessageCreateParamsStreaming): void {
  const toolCacheControl = state.compat.supportsCacheControlOnTools
    ? state.cacheControl
    : undefined;
  if (state.nativeToolChanges) {
    params.tools = [
      ...convertToolDefinitions(state, [...state.initialTools], toolCacheControl),
      DEFERRED_TOOL_PLACEHOLDER,
    ];
    return;
  }
  const tools = getCurrentTools(state.context.messages);
  if (tools.length > 0) {
    params.tools = convertToolDefinitions(state, tools, toolCacheControl);
  }
}

function applyThinking(state: BuildParamsState, params: MessageCreateParamsStreaming): void {
  const { model, options } = state;
  if (state.thinkingDisabled) {
    params.thinking = { type: "disabled" };
    return;
  }
  if (state.effortMessages) {
    params.thinking = {
      type: "adaptive",
      display: options?.thinkingDisplay ?? "summarized",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    };
    params.output_config = { effort: "high" };
    return;
  }
  if (!(model.reasoning && options?.thinkingEnabled === true)) return;
  const display = options.thinkingDisplay ?? "summarized";
  if (model.compat?.forceAdaptiveThinking === true) {
    params.thinking = { type: "adaptive", display };
    if (options.effort !== undefined) {
      params.output_config = { effort: options.effort };
    }
    return;
  }
  params.thinking = {
    type: "enabled",
    budget_tokens: options.thinkingBudgetTokens || 1024,
    display,
  };
}

interface CreateStateInput {
  readonly model: Model<"anthropic-messages">;
  readonly context: TranscriptContext;
  readonly usesOAuth: boolean;
  readonly options: AnthropicOptions | undefined;
  readonly disablePreferredStrictTools: boolean;
}

function createState(input: CreateStateInput): {
  state: BuildParamsState;
  conversationMessages: Message[];
} {
  const { model, context, usesOAuth, options, disablePreferredStrictTools } = input;
  const cacheControl = getCacheControl({
    model,
    cacheRetention: options?.cacheRetention,
    env: options?.env,
  }).cacheControl;
  const compat = getAnthropicCompat(model);
  const initialSystemMessage = getInitialSystemMessage(context.messages);
  const initialSystemText =
    initialSystemMessage === undefined ? "" : getSystemMessageText(initialSystemMessage);
  const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);
  const conversationMessages =
    initialSystemMessage === undefined ? transformedMessages : transformedMessages.slice(1);
  const initialTools = initialSystemMessage?.toolsAdded ?? [];
  const nativeToolChanges =
    compat.supportsMidConvoSystemMessages &&
    compat.supportsMidConvoToolChanges &&
    initialTools.length > 0;
  const thinkingDisabled =
    model.reasoning && options?.thinkingEnabled === false && model.thinkingLevelMap?.off !== null;
  const effortMessages = model.compat?.supportsMidConvoEffort === true && !thinkingDisabled;
  const state: BuildParamsState = {
    model,
    context,
    usesOAuth,
    options,
    compat,
    cacheControl,
    initialSystemText,
    initialTools,
    nativeToolChanges,
    thinkingDisabled,
    effortMessages,
    activeEffort: options?.effort ?? "high",
    disablePreferredStrictTools,
    hasPreferredStrictTools: false,
  };
  return { state, conversationMessages };
}

function createRequest(
  state: BuildParamsState,
  converted: ConvertedAnthropicMessages,
): MessageCreateParamsStreaming {
  const { model, context, usesOAuth, options } = state;
  const betaFeatures = getBetaFeatures({
    model,
    context,
    usesOAuth,
    nativeToolChanges: state.nativeToolChanges,
    options,
  });
  const params: MessageCreateParamsStreaming = {
    model: model.id,
    messages: state.effortMessages
      ? insertThinkingLevelMessages({ converted, activeEffort: state.activeEffort })
      : converted.messages,
    max_tokens: options?.maxTokens ?? model.maxTokens,
    stream: true,
    ...(betaFeatures.length > 0 ? { betas: betaFeatures } : {}),
  };
  const system = buildSystem({
    usesOAuth: state.usesOAuth,
    initialSystemText: state.initialSystemText,
    cacheControl: state.cacheControl,
  });
  if (system !== undefined) params.system = system;
  if (shouldSendTemperature(state) && options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  applyTools(state, params);
  applyThinking(state, params);
  applyParamsOptions({ model, options, params });
  return params;
}

interface BuildParamsInput {
  readonly model: Model<"anthropic-messages">;
  readonly context: TranscriptContext;
  readonly usesOAuth: boolean;
  readonly options?: AnthropicOptions | undefined;
  readonly disablePreferredStrictTools?: boolean | undefined;
}

function buildParams(input: BuildParamsInput): {
  params: MessageCreateParamsStreaming;
  hasPreferredStrictTools: boolean;
  providerThinkingLevel: AnthropicEffort | undefined;
} {
  const { model, context, usesOAuth, options } = input;
  const { state, conversationMessages } = createState({
    model,
    context,
    usesOAuth,
    options,
    disablePreferredStrictTools: input.disablePreferredStrictTools ?? false,
  });
  const converted = convertMessages({
    messages: conversationMessages,
    usesOAuth,
    cacheControl: state.cacheControl,
    allowEmptySignature: state.compat.allowEmptySignature,
    managedProvider: state.effortMessages ? model.provider : undefined,
    convertToolDefinitions: state.nativeToolChanges
      ? (tools) => convertToolDefinitions(state, tools)
      : undefined,
  });
  return {
    params: createRequest(state, converted),
    hasPreferredStrictTools: state.hasPreferredStrictTools,
    providerThinkingLevel: state.effortMessages ? state.activeEffort : undefined,
  };
}

export { buildParams };
