import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import modelCallModule from "../utils/model-call.ts";
import transcript from "../utils/transcript.ts";
import openaiResponsesConfig from "./openai-responses-config.ts";
import type openaiResponsesConfigTypes from "./openai-responses-config.types.ts";
import openaiResponsesKit from "./openai-responses-kit.ts";
import openaiResponsesReasoning from "./openai-responses-reasoning.ts";
import openaiResponsesRequest from "./openai-responses-request.ts";
import openaiResponsesRun from "./openai-responses-run.ts";

const { clock, errorBody } = openaiResponsesKit;

const { formatProviderError, normalizeProviderError, recordErrorStatus } = errorBody;
const { currentTimeMillis } = clock;
const { modelCall } = modelCallModule;
const { resolveTranscript } = transcript;
const { getClientApiKey, getCompat, getConfigurationUpdateEffort } = openaiResponsesConfig;
const { runResponsesStream } = openaiResponsesRun;
const { prepareOpenAIResponsesRequest } = openaiResponsesRequest;
const { responsesSimpleOptions } = openaiResponsesReasoning;

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

type ResponsesModel = typesModule.Model<"openai-responses">;
type Stream<O extends typesModule.StreamOptions> = typesModule.StreamFunction<
  "openai-responses",
  O
>;

function recordOpenAIError(
  model: ResponsesModel,
): (output: typesModule.AssistantMessage, error: unknown) => void {
  return (output, error) => {
    const failure = normalizeProviderError(error);
    const message = formatProviderError(
      failure,
      `${model.provider === "openai" ? "OpenAI" : model.provider} API error`,
    );
    output.errorMessage = message.includes("subscription_sharing_usage_limit_exceeded")
      ? `${message}\nCheck your ChatGPT usage: ${CHATGPT_USAGE_URL}`
      : message;
    recordErrorStatus(output, failure);
  };
}

function pendingOutput(
  model: ResponsesModel,
  configurationUpdateEffort: string | undefined,
): typesModule.AssistantMessage {
  return {
    api: model.api as typesModule.Api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
    ...(configurationUpdateEffort === undefined
      ? {}
      : { providerThinkingLevel: configurationUpdateEffort }),
  };
}

const stream = modelCall<
  Parameters<Stream<openaiResponsesConfigTypes.OpenAIResponsesOptions>>[0],
  Parameters<Stream<openaiResponsesConfigTypes.OpenAIResponsesOptions>>[1],
  NonNullable<Parameters<Stream<openaiResponsesConfigTypes.OpenAIResponsesOptions>>[2]>,
  ReturnType<Stream<openaiResponsesConfigTypes.OpenAIResponsesOptions>>
>(
  (
    model: ResponsesModel,
    context: typesModule.TranscriptContext,
    options?: openaiResponsesConfigTypes.OpenAIResponsesOptions,
  ): eventStreamTypes.AssistantMessageEventStream => {
    const normalized = resolveTranscript(context, getCompat(model).supportsMidConvoSystemMessages);
    const configurationUpdateEffort = getConfigurationUpdateEffort(model)(options);
    return runResponsesStream({
      model,
      options,
      output: pendingOutput(model, configurationUpdateEffort),
      prepare: () =>
        prepareOpenAIResponsesRequest({
          configurationUpdateEffort,
          context: normalized,
          model,
          options,
        }),
      recordError: recordOpenAIError(model),
      streamName: "OpenAI Responses",
    });
  },
);

const streamSimple = modelCall<
  Parameters<Stream<typesModule.SimpleStreamOptions>>[0],
  Parameters<Stream<typesModule.SimpleStreamOptions>>[1],
  NonNullable<Parameters<Stream<typesModule.SimpleStreamOptions>>[2]>,
  ReturnType<Stream<typesModule.SimpleStreamOptions>>
>(
  (
    model: ResponsesModel,
    context: typesModule.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
  ): eventStreamTypes.AssistantMessageEventStream => {
    getClientApiKey(model)(options);
    const apiKey = options?.apiKey;
    return stream(model, context, responsesSimpleOptions({ apiKey, context, model, options }));
  },
);

const openaiResponses = {
  stream,
  streamSimple,
};

export default openaiResponses;
