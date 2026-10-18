import { Effect } from "effect";

import type { Model, SimpleStreamOptions, StreamFunction } from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { modelCall } from "../utils/model-call.ts";
import { getCurrentTools, resolveTranscript, type TranscriptContext } from "../utils/transcript.ts";
import { assertRequestAuth, getAnthropicFederation } from "./anthropic-messages-client.ts";
import { getAnthropicCompat, mapThinkingLevelToEffort } from "./anthropic-messages-compat.ts";
import type { AnthropicOptions } from "./anthropic-messages-options.ts";
import { runAnthropicRequest } from "./anthropic-messages-stream.ts";
import {
  adjustMaxTokensForThinking,
  buildBaseOptions,
  clampMaxTokensToContext,
} from "./simple-options.ts";

export type { AnthropicEffort, AnthropicThinkingDisplay } from "./anthropic-messages-compat.ts";
export type { AnthropicOptions } from "./anthropic-messages-options.ts";

export const stream = modelCall<
  Parameters<StreamFunction<"anthropic-messages", AnthropicOptions>>[0],
  Parameters<StreamFunction<"anthropic-messages", AnthropicOptions>>[1],
  NonNullable<Parameters<StreamFunction<"anthropic-messages", AnthropicOptions>>[2]>,
  ReturnType<StreamFunction<"anthropic-messages", AnthropicOptions>>
>(
  (
    model: Model<"anthropic-messages">,
    context: TranscriptContext,
    options?: AnthropicOptions,
  ): AssistantMessageEventStream => {
    const events = new AssistantMessageEventStream();
    const normalizedContext = resolveTranscript(
      context,
      getAnthropicCompat(model).supportsMidConvoSystemMessages,
    );
    const currentTools = getCurrentTools(normalizedContext.messages);
    Effect.runFork(
      runAnthropicRequest({
        model,
        context: normalizedContext,
        options,
        events,
        currentTools,
      }),
    );
    return events;
  },
);

function simpleStreamOptions(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
): AnthropicOptions {
  const base = {
    ...buildBaseOptions(model, context, options, options?.apiKey),
    toolChoice: options?.toolChoice,
  } satisfies AnthropicOptions;
  if (options?.reasoning === undefined) {
    return { ...base, thinkingEnabled: false };
  }
  if (model.compat?.forceAdaptiveThinking === true) {
    return {
      ...base,
      thinkingEnabled: true,
      effort: mapThinkingLevelToEffort({ model, level: options.reasoning }),
    };
  }
  const adjusted = adjustMaxTokensForThinking(
    base.maxTokens,
    model.maxTokens,
    options.reasoning,
    options.thinkingBudgets,
  );
  const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);
  return {
    ...base,
    maxTokens,
    thinkingEnabled: true,
    thinkingBudgetTokens: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
  };
}

export const streamSimple = modelCall<
  Parameters<StreamFunction<"anthropic-messages", SimpleStreamOptions>>[0],
  Parameters<StreamFunction<"anthropic-messages", SimpleStreamOptions>>[1],
  NonNullable<Parameters<StreamFunction<"anthropic-messages", SimpleStreamOptions>>[2]>,
  ReturnType<StreamFunction<"anthropic-messages", SimpleStreamOptions>>
>(
  (
    model: Model<"anthropic-messages">,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    if (
      getAnthropicFederation({
        model,
        apiKey: options?.apiKey,
        headers: options?.headers,
        env: options?.env,
      }) === undefined
    ) {
      assertRequestAuth({
        provider: model.provider,
        apiKey: options?.apiKey,
        headers: options?.headers,
      });
    }
    return stream(model, context, simpleStreamOptions(model, context, options));
  },
);
