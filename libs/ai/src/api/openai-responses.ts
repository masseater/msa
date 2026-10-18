import type {
  Api,
  AssistantMessage,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  TranscriptContext,
} from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { modelCall } from "../utils/model-call.ts";
import { resolveTranscript } from "../utils/transcript.ts";
import {
  getClientApiKey,
  getCompat,
  getConfigurationUpdateEffort,
  type OpenAIResponsesOptions,
} from "./openai-responses-config.ts";
import { responsesSimpleOptions } from "./openai-responses-reasoning.ts";
import { prepareOpenAIResponsesRequest } from "./openai-responses-request.ts";
import { runResponsesStream } from "./openai-responses-run.ts";

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

type ResponsesModel = Model<"openai-responses">;
type Stream<O extends StreamOptions> = StreamFunction<"openai-responses", O>;

function formatOpenAIError(model: ResponsesModel): (error: unknown) => string {
  return (error) => {
    const message = formatProviderError(
      normalizeProviderError(error),
      `${model.provider === "openai" ? "OpenAI" : model.provider} API error`,
    );
    return message.includes("subscription_sharing_usage_limit_exceeded")
      ? `${message}\nCheck your ChatGPT usage: ${CHATGPT_USAGE_URL}`
      : message;
  };
}

function pendingOutput(
  model: ResponsesModel,
  configurationUpdateEffort: string | undefined,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api as Api,
    provider: model.provider,
    model: model.id,
    ...(configurationUpdateEffort === undefined
      ? {}
      : { providerThinkingLevel: configurationUpdateEffort }),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: currentTimeMillis(),
  };
}

export const stream = modelCall<
  Parameters<Stream<OpenAIResponsesOptions>>[0],
  Parameters<Stream<OpenAIResponsesOptions>>[1],
  NonNullable<Parameters<Stream<OpenAIResponsesOptions>>[2]>,
  ReturnType<Stream<OpenAIResponsesOptions>>
>(
  (
    model: ResponsesModel,
    context: TranscriptContext,
    options?: OpenAIResponsesOptions,
  ): AssistantMessageEventStream => {
    const normalized = resolveTranscript(context, getCompat(model).supportsMidConvoSystemMessages);
    const configurationUpdateEffort = getConfigurationUpdateEffort(model)(options);
    return runResponsesStream({
      model,
      options,
      output: pendingOutput(model, configurationUpdateEffort),
      streamName: "OpenAI Responses",
      prepare: () =>
        prepareOpenAIResponsesRequest({
          model,
          context: normalized,
          options,
          configurationUpdateEffort,
        }),
      formatError: formatOpenAIError(model),
    });
  },
);

export const streamSimple = modelCall<
  Parameters<Stream<SimpleStreamOptions>>[0],
  Parameters<Stream<SimpleStreamOptions>>[1],
  NonNullable<Parameters<Stream<SimpleStreamOptions>>[2]>,
  ReturnType<Stream<SimpleStreamOptions>>
>(
  (
    model: ResponsesModel,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    getClientApiKey(model)(options);
    const apiKey = options?.apiKey;
    return stream(model, context, responsesSimpleOptions({ model, context, options, apiKey }));
  },
);
