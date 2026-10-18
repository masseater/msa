import { clampThinkingLevel } from "../models.ts";
import type {
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  TranscriptContext,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { modelCall } from "../utils/model-call.ts";
import { resolveTranscript } from "../utils/transcript.ts";
import type { OpenAICodexResponsesOptions } from "./openai-codex-options.ts";
import { startCodexStream } from "./openai-codex-run.ts";
import { buildBaseOptions } from "./simple-options.ts";

type CodexModel = Model<"openai-codex-responses">;
type Stream<O extends StreamOptions> = StreamFunction<"openai-codex-responses", O>;

export const stream = modelCall<
  Parameters<Stream<OpenAICodexResponsesOptions>>[0],
  Parameters<Stream<OpenAICodexResponsesOptions>>[1],
  NonNullable<Parameters<Stream<OpenAICodexResponsesOptions>>[2]>,
  ReturnType<Stream<OpenAICodexResponsesOptions>>
>(
  (
    model: CodexModel,
    context: TranscriptContext,
    options?: OpenAICodexResponsesOptions,
  ): AssistantMessageEventStream =>
    startCodexStream({
      model,
      context: resolveTranscript(context, model.compat?.supportsMidConvoSystemMessages),
      options,
    }),
);

export const streamSimple = modelCall<
  Parameters<Stream<SimpleStreamOptions>>[0],
  Parameters<Stream<SimpleStreamOptions>>[1],
  NonNullable<Parameters<Stream<SimpleStreamOptions>>[2]>,
  ReturnType<Stream<SimpleStreamOptions>>
>(
  (
    model: CodexModel,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const apiKey = options?.apiKey;
    if (apiKey === undefined || apiKey === "") {
      throw new Error(`No API key for provider: ${model.provider}`);
    }
    const clamped =
      options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
    return stream(model, context, {
      ...buildBaseOptions(model, context, options, apiKey),
      toolChoice: options?.toolChoice,
      reasoningEffort: clamped === "off" ? undefined : clamped,
    } satisfies OpenAICodexResponsesOptions);
  },
);
