import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import modelCallModule from "../utils/model-call.ts";
import transcript from "../utils/transcript.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";
import openaiCodexRun from "./openai-codex-run.ts";
import simpleOptions from "./simple-options.ts";

const { modelCall } = modelCallModule;
const { startCodexStream } = openaiCodexRun;
const { resolveTranscript } = transcript;
const { clampThinkingLevel } = modelsModule;
const { buildBaseOptions } = simpleOptions;

type CodexModel = typesModule.Model<"openai-codex-responses">;
type Stream<O extends typesModule.StreamOptions> = typesModule.StreamFunction<
  "openai-codex-responses",
  O
>;

const stream = modelCall<
  Parameters<Stream<openaiCodexOptionsTypes.OpenAICodexResponsesOptions>>[0],
  Parameters<Stream<openaiCodexOptionsTypes.OpenAICodexResponsesOptions>>[1],
  NonNullable<Parameters<Stream<openaiCodexOptionsTypes.OpenAICodexResponsesOptions>>[2]>,
  ReturnType<Stream<openaiCodexOptionsTypes.OpenAICodexResponsesOptions>>
>(
  (
    model: CodexModel,
    context: typesModule.TranscriptContext,
    options?: openaiCodexOptionsTypes.OpenAICodexResponsesOptions,
  ): eventStreamTypes.AssistantMessageEventStream =>
    startCodexStream({
      context: resolveTranscript(context, model.compat?.supportsMidConvoSystemMessages),
      model,
      options,
    }),
);

const streamSimple = modelCall<
  Parameters<Stream<typesModule.SimpleStreamOptions>>[0],
  Parameters<Stream<typesModule.SimpleStreamOptions>>[1],
  NonNullable<Parameters<Stream<typesModule.SimpleStreamOptions>>[2]>,
  ReturnType<Stream<typesModule.SimpleStreamOptions>>
>(
  (
    model: CodexModel,
    context: typesModule.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
  ): eventStreamTypes.AssistantMessageEventStream => {
    const apiKey = options?.apiKey;
    if (apiKey === undefined || apiKey === "") {
      throw new Error(`No API key for provider: ${model.provider}`);
    }
    const clamped =
      options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
    return stream(model, context, {
      ...buildBaseOptions(model, context, options, apiKey),
      reasoningEffort: clamped === "off" ? undefined : clamped,
      toolChoice: options?.toolChoice,
    } satisfies openaiCodexOptionsTypes.OpenAICodexResponsesOptions);
  },
);

const openaiCodexResponses = {
  stream,
  streamSimple,
};

export default openaiCodexResponses;
