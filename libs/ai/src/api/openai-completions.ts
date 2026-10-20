import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import openaiCompletionsClient from "./openai-completions-client.ts";
import openaiCompletionsKit from "./openai-completions-kit.ts";
import openaiCompletionsMessages from "./openai-completions-messages.ts";
import openaiCompletionsStream from "./openai-completions-stream.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";
import simpleOptions from "./simple-options.ts";

const { eventStream, modelCall: modelCallModule, models: modelsModule } = openaiCompletionsKit;

const { modelCall } = modelCallModule;
const { AssistantMessageEventStream } = eventStream;
const { runCompletionsStream } = openaiCompletionsStream;
const { getClientApiKey } = openaiCompletionsClient;
const { buildBaseOptions } = simpleOptions;
const { clampThinkingLevel } = modelsModule;

const stream = modelCall<
  Parameters<
    typesModule.StreamFunction<
      "openai-completions",
      openaiCompletionsTypesModule.OpenAICompletionsOptions
    >
  >[0],
  Parameters<
    typesModule.StreamFunction<
      "openai-completions",
      openaiCompletionsTypesModule.OpenAICompletionsOptions
    >
  >[1],
  NonNullable<
    Parameters<
      typesModule.StreamFunction<
        "openai-completions",
        openaiCompletionsTypesModule.OpenAICompletionsOptions
      >
    >[2]
  >,
  ReturnType<
    typesModule.StreamFunction<
      "openai-completions",
      openaiCompletionsTypesModule.OpenAICompletionsOptions
    >
  >
>(
  (
    model: typesModule.Model<"openai-completions">,
    context: transcriptTypes.TranscriptContext,
    options?: openaiCompletionsTypesModule.OpenAICompletionsOptions,
  ): eventStreamTypes.AssistantMessageEventStream => {
    const events = new AssistantMessageEventStream();
    Effect.runFork(
      runCompletionsStream({
        context,
        events,
        model,
        options,
      }),
    );
    return events;
  },
);

const streamSimple = modelCall<
  Parameters<typesModule.StreamFunction<"openai-completions", typesModule.SimpleStreamOptions>>[0],
  Parameters<typesModule.StreamFunction<"openai-completions", typesModule.SimpleStreamOptions>>[1],
  NonNullable<
    Parameters<typesModule.StreamFunction<"openai-completions", typesModule.SimpleStreamOptions>>[2]
  >,
  ReturnType<typesModule.StreamFunction<"openai-completions", typesModule.SimpleStreamOptions>>
>(
  (
    model: typesModule.Model<"openai-completions">,
    context: transcriptTypes.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
  ): eventStreamTypes.AssistantMessageEventStream => {
    getClientApiKey({
      apiKey: options?.apiKey,
      headers: options?.headers,
      provider: model.provider,
    });

    const base = {
      ...buildBaseOptions(model, context, options, options?.apiKey),
      toolChoice: options?.toolChoice,
    } satisfies openaiCompletionsTypesModule.OpenAICompletionsOptions;
    const clampedReasoning =
      options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
    const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;

    return stream(model, context, {
      ...base,
      reasoningEffort,
      thinkingBudgets: options?.thinkingBudgets,
    } satisfies openaiCompletionsTypesModule.OpenAICompletionsOptions);
  },
);

const openaiCompletions = {
  convertMessages: openaiCompletionsMessages.convertMessages,
  stream,
  streamSimple,
};

export default openaiCompletions;
