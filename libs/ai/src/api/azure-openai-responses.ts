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
import type { AzureOpenAIResponsesOptions } from "./azure-openai-responses-params.ts";
import {
  prepareAzureResponsesRequest,
  requireAzureApiKey,
} from "./azure-openai-responses-request.ts";
import { responsesSimpleOptions } from "./openai-responses-reasoning.ts";
import { runResponsesStream } from "./openai-responses-run.ts";

type AzureModel = Model<"azure-openai-responses">;
type Stream<O extends StreamOptions> = StreamFunction<"azure-openai-responses", O>;

function pendingOutput(model: AzureModel): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "azure-openai-responses" as Api,
    provider: model.provider,
    model: model.id,
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

const formatAzureOpenAIError = (error: unknown): string =>
  formatProviderError(normalizeProviderError(error), "Azure OpenAI API error");

export const stream = modelCall<
  Parameters<Stream<AzureOpenAIResponsesOptions>>[0],
  Parameters<Stream<AzureOpenAIResponsesOptions>>[1],
  NonNullable<Parameters<Stream<AzureOpenAIResponsesOptions>>[2]>,
  ReturnType<Stream<AzureOpenAIResponsesOptions>>
>(
  (
    model: AzureModel,
    context: TranscriptContext,
    options?: AzureOpenAIResponsesOptions,
  ): AssistantMessageEventStream => {
    const normalized = resolveTranscript(context, model.compat?.supportsMidConvoSystemMessages);
    return runResponsesStream({
      model,
      options,
      output: pendingOutput(model),
      streamName: "Azure OpenAI Responses",
      prepare: () => prepareAzureResponsesRequest({ model, context: normalized, options }),
      formatError: formatAzureOpenAIError,
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
    model: AzureModel,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const apiKey = requireAzureApiKey(model)(options);
    return stream(model, context, responsesSimpleOptions({ model, context, options, apiKey }));
  },
);
