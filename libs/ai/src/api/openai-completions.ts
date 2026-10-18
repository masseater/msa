import { Effect } from "effect";

import { clampThinkingLevel } from "../models.ts";
import type { Model, SimpleStreamOptions, StreamFunction } from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { modelCall } from "../utils/model-call.ts";
import type { TranscriptContext } from "../utils/transcript.ts";
import { getClientApiKey } from "./openai-completions-client.ts";
import { runCompletionsStream } from "./openai-completions-stream.ts";
import type { OpenAICompletionsOptions } from "./openai-completions-types.ts";
import { buildBaseOptions } from "./simple-options.ts";

export type { ConvertCompletionsMessagesOptions } from "./openai-completions-messages.ts";
export { convertMessages } from "./openai-completions-messages.ts";
export type { OpenAICompletionsOptions } from "./openai-completions-types.ts";

export const stream = modelCall<
  Parameters<StreamFunction<"openai-completions", OpenAICompletionsOptions>>[0],
  Parameters<StreamFunction<"openai-completions", OpenAICompletionsOptions>>[1],
  NonNullable<Parameters<StreamFunction<"openai-completions", OpenAICompletionsOptions>>[2]>,
  ReturnType<StreamFunction<"openai-completions", OpenAICompletionsOptions>>
>(
  (
    model: Model<"openai-completions">,
    context: TranscriptContext,
    options?: OpenAICompletionsOptions,
  ): AssistantMessageEventStream => {
    const events = new AssistantMessageEventStream();
    Effect.runFork(
      runCompletionsStream({
        model,
        context,
        options,
        events,
      }),
    );
    return events;
  },
);

export const streamSimple = modelCall<
  Parameters<StreamFunction<"openai-completions", SimpleStreamOptions>>[0],
  Parameters<StreamFunction<"openai-completions", SimpleStreamOptions>>[1],
  NonNullable<Parameters<StreamFunction<"openai-completions", SimpleStreamOptions>>[2]>,
  ReturnType<StreamFunction<"openai-completions", SimpleStreamOptions>>
>(
  (
    model: Model<"openai-completions">,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    getClientApiKey({
      provider: model.provider,
      apiKey: options?.apiKey,
      headers: options?.headers,
    });

    const base = {
      ...buildBaseOptions(model, context, options, options?.apiKey),
      toolChoice: options?.toolChoice,
    } satisfies OpenAICompletionsOptions;
    const clampedReasoning =
      options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
    const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;

    return stream(model, context, {
      ...base,
      reasoningEffort,
      thinkingBudgets: options?.thinkingBudgets,
    } satisfies OpenAICompletionsOptions);
  },
);
