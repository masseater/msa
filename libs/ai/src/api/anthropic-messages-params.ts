import type {
  BetaTool,
  BetaCacheControlEphemeral as CacheControlEphemeral,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import type anthropicMessagesCompatTypes from "./anthropic-messages-compat.types.ts";
import type anthropicMessagesConvertTypes from "./anthropic-messages-convert.types.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";
import anthropicMessagesParamsKit from "./anthropic-messages-params-kit.ts";
import anthropicMessagesParamsOptions from "./anthropic-messages-params-options.ts";
import anthropicMessagesTools from "./anthropic-messages-tools.ts";
import transformMessagesModule from "./transform-messages.ts";

const {
  anthropicMessagesCompat,
  anthropicMessagesConvert,
  text: textModule,
  transcript,
} = anthropicMessagesParamsKit;

const { DEFERRED_TOOL_PLACEHOLDER, getAnthropicCompat, getCacheControl } = anthropicMessagesCompat;
const { convertTools, getBetaFeatures } = anthropicMessagesTools;
const { getCurrentTools, getInitialSystemMessage } = transcript;
const { getSystemMessageText } = textModule;
const { transformMessages } = transformMessagesModule;
const { convertMessages, insertThinkingLevelMessages, normalizeToolCallId } =
  anthropicMessagesConvert;
const { applyParamsOptions, buildSystem } = anthropicMessagesParamsOptions;

type AnthropicCompat = ReturnType<typeof getAnthropicCompat>;

interface BuildParamsState {
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly context: transcriptTypes.TranscriptContext;
  readonly options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
  readonly compat: AnthropicCompat;
  readonly cacheControl: CacheControlEphemeral | undefined;
  readonly initialSystemText: string;
  readonly initialTools: ReadonlyArray<typesModule.Tool>;
  readonly nativeToolChanges: boolean;
  readonly thinkingDisabled: boolean;
  readonly effortMessages: boolean;
  readonly activeEffort: anthropicMessagesCompatTypes.AnthropicEffort;
  readonly disablePreferredStrictTools: boolean;
  hasPreferredStrictTools: boolean;
}

function convertToolDefinitions(
  state: BuildParamsState,
  tools: typesModule.Tool[],
  toolCacheControl?: CacheControlEphemeral,
): BetaTool[] {
  const definitions = convertTools({
    cacheControl: toolCacheControl,
    disablePreferredStrictTools: state.disablePreferredStrictTools,
    supportsEagerToolInputStreaming: state.compat.supportsEagerToolInputStreaming,
    supportsStrictTools: state.compat.supportsStrictTools,
    tools,
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
      block_binding: { prefix_mismatch_behavior: "drop_block" },
      display: options?.thinkingDisplay ?? "summarized",
      type: "adaptive",
    };
    params.output_config = { effort: "high" };
    return;
  }
  if (!(model.reasoning && options?.thinkingEnabled === true)) return;
  const display = options.thinkingDisplay ?? "summarized";
  if (model.compat?.forceAdaptiveThinking === true) {
    params.thinking = { display, type: "adaptive" };
    if (options.effort !== undefined) {
      params.output_config = { effort: options.effort };
    }
    return;
  }
  params.thinking = {
    budget_tokens: options.thinkingBudgetTokens || 1024,
    display,
    type: "enabled",
  };
}

interface CreateStateInput {
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly context: transcriptTypes.TranscriptContext;
  readonly options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
  readonly disablePreferredStrictTools: boolean;
}

function createState(input: CreateStateInput): {
  state: BuildParamsState;
  conversationMessages: typesModule.Message[];
} {
  const { model, context, options, disablePreferredStrictTools } = input;
  const cacheControl = getCacheControl({
    cacheRetention: options?.cacheRetention,
    env: options?.env,
    model,
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
    activeEffort: options?.effort ?? "high",
    cacheControl,
    compat,
    context,
    disablePreferredStrictTools,
    effortMessages,
    hasPreferredStrictTools: false,
    initialSystemText,
    initialTools,
    model,
    nativeToolChanges,
    options,
    thinkingDisabled,
  };
  return { conversationMessages, state };
}

function createRequest(
  state: BuildParamsState,
  converted: anthropicMessagesConvertTypes.ConvertedAnthropicMessages,
): MessageCreateParamsStreaming {
  const { model, context, options } = state;
  const betaFeatures = getBetaFeatures({
    context,
    model,
    nativeToolChanges: state.nativeToolChanges,
    options,
  });
  const params: MessageCreateParamsStreaming = {
    max_tokens: options?.maxTokens ?? model.maxTokens,
    messages: state.effortMessages
      ? insertThinkingLevelMessages({ activeEffort: state.activeEffort, converted })
      : converted.messages,
    model: model.id,
    stream: true,
    ...(betaFeatures.length > 0 ? { betas: betaFeatures } : {}),
  };
  const system = buildSystem({
    cacheControl: state.cacheControl,
    initialSystemText: state.initialSystemText,
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
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly context: transcriptTypes.TranscriptContext;
  readonly options?: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
  readonly disablePreferredStrictTools?: boolean | undefined;
}

function buildParams(input: BuildParamsInput): {
  params: MessageCreateParamsStreaming;
  hasPreferredStrictTools: boolean;
  providerThinkingLevel: anthropicMessagesCompatTypes.AnthropicEffort | undefined;
} {
  const { model, context, options } = input;
  const { state, conversationMessages } = createState({
    context,
    disablePreferredStrictTools: input.disablePreferredStrictTools ?? false,
    model,
    options,
  });
  const converted = convertMessages({
    allowEmptySignature: state.compat.allowEmptySignature,
    cacheControl: state.cacheControl,
    convertToolDefinitions: state.nativeToolChanges
      ? (tools) => convertToolDefinitions(state, tools)
      : undefined,
    managedProvider: state.effortMessages ? model.provider : undefined,
    messages: conversationMessages,
  });
  const params = createRequest(state, converted);
  return {
    hasPreferredStrictTools: state.hasPreferredStrictTools,
    params,
    providerThinkingLevel: state.effortMessages ? state.activeEffort : undefined,
  };
}

const anthropicMessagesParams = {
  buildParams,
};

export default anthropicMessagesParams;
