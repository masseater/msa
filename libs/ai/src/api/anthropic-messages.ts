import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import anthropicMessagesKit from "./anthropic-messages-kit.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";
import anthropicMessagesParams from "./anthropic-messages-params.ts";
import anthropicMessagesRun from "./anthropic-messages-run.ts";
import anthropicMessagesStream from "./anthropic-messages-stream.ts";
import simpleOptions from "./simple-options.ts";

const {
  anthropicMessagesClient,
  anthropicMessagesCompat,
  eventStream,
  modelCall: modelCallModule,
  transcript,
} = anthropicMessagesKit;

const { modelCall } = modelCallModule;
const { AssistantMessageEventStream } = eventStream;
const { resolveTranscript } = transcript;
const { getAnthropicCompat, mapThinkingLevelToEffort } = anthropicMessagesCompat;
const { runAnthropicRequest } = anthropicMessagesStream;
const { assertRequestAuth, getAnthropicFederation } = anthropicMessagesClient;
const { adjustMaxTokensForThinking, buildBaseOptions, clampMaxTokensToContext } = simpleOptions;
const { resolveClient } = anthropicMessagesRun;
const { buildParams } = anthropicMessagesParams;

const stream = modelCall<
  Parameters<
    typesModule.StreamFunction<"anthropic-messages", anthropicMessagesOptionsTypes.AnthropicOptions>
  >[0],
  Parameters<
    typesModule.StreamFunction<"anthropic-messages", anthropicMessagesOptionsTypes.AnthropicOptions>
  >[1],
  NonNullable<
    Parameters<
      typesModule.StreamFunction<
        "anthropic-messages",
        anthropicMessagesOptionsTypes.AnthropicOptions
      >
    >[2]
  >,
  ReturnType<
    typesModule.StreamFunction<"anthropic-messages", anthropicMessagesOptionsTypes.AnthropicOptions>
  >
>(
  (
    model: typesModule.Model<"anthropic-messages">,
    context: transcriptTypes.TranscriptContext,
    options?: anthropicMessagesOptionsTypes.AnthropicOptions,
  ): eventStreamTypes.AssistantMessageEventStream => {
    const events = new AssistantMessageEventStream();
    const normalizedContext = resolveTranscript(
      context,
      getAnthropicCompat(model).supportsMidConvoSystemMessages,
    );
    Effect.runFork(runAnthropicRequest({ context: normalizedContext, events, model, options }));
    return events;
  },
);

function simpleStreamOptions(
  model: typesModule.Model<"anthropic-messages">,
  context: transcriptTypes.TranscriptContext,
  options: typesModule.SimpleStreamOptions | undefined,
): anthropicMessagesOptionsTypes.AnthropicOptions {
  if (
    getAnthropicFederation({
      apiKey: options?.apiKey,
      env: options?.env,
      headers: options?.headers,
      model,
    }) === undefined
  ) {
    assertRequestAuth({
      apiKey: options?.apiKey,
      headers: options?.headers,
      provider: model.provider,
    });
  }
  const base = {
    ...buildBaseOptions(model, context, options, options?.apiKey),
    toolChoice: options?.toolChoice,
  } satisfies anthropicMessagesOptionsTypes.AnthropicOptions;
  if (options?.reasoning === undefined) {
    return { ...base, thinkingEnabled: false };
  }
  if (model.compat?.forceAdaptiveThinking === true) {
    return {
      ...base,
      effort: mapThinkingLevelToEffort({ level: options.reasoning, model }),
      thinkingEnabled: true,
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
    thinkingBudgetTokens: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
    thinkingEnabled: true,
  };
}

const streamSimple = modelCall<
  Parameters<typesModule.StreamFunction<"anthropic-messages", typesModule.SimpleStreamOptions>>[0],
  Parameters<typesModule.StreamFunction<"anthropic-messages", typesModule.SimpleStreamOptions>>[1],
  NonNullable<
    Parameters<typesModule.StreamFunction<"anthropic-messages", typesModule.SimpleStreamOptions>>[2]
  >,
  ReturnType<typesModule.StreamFunction<"anthropic-messages", typesModule.SimpleStreamOptions>>
>(
  (
    model: typesModule.Model<"anthropic-messages">,
    context: transcriptTypes.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
  ): eventStreamTypes.AssistantMessageEventStream =>
    stream(model, context, simpleStreamOptions(model, context, options)),
);

const countTokens = (
  model: typesModule.Model<"anthropic-messages">,
  context: transcriptTypes.TranscriptContext,
  options?: typesModule.SimpleStreamOptions,
): Promise<number> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const anthropicOptions = simpleStreamOptions(model, context, options);
      const client = resolveClient({ model, options: anthropicOptions });
      const normalizedContext = resolveTranscript(
        context,
        getAnthropicCompat(model).supportsMidConvoSystemMessages,
      );
      const { params } = buildParams({
        context: normalizedContext,
        model,
        options: anthropicOptions,
      });
      const counted = yield* Effect.promise(() =>
        client.beta.messages.countTokens(
          {
            messages: params.messages,
            model: params.model,
            ...(params.system === undefined ? {} : { system: params.system }),
            ...(params.tools === undefined ? {} : { tools: params.tools }),
            ...(params.thinking === undefined ? {} : { thinking: params.thinking }),
            ...(params.tool_choice === undefined ? {} : { tool_choice: params.tool_choice }),
            ...(params.output_config === undefined ? {} : { output_config: params.output_config }),
            ...(params.context_management === undefined || params.context_management === null
              ? {}
              : { context_management: params.context_management }),
            ...(params.betas === undefined ? {} : { betas: params.betas }),
          },
          { ...(options?.signal === undefined ? {} : { signal: options.signal }), maxRetries: 0 },
        ),
      );
      return counted.input_tokens;
    }),
  );

const anthropicMessages = {
  countTokens,
  stream,
  streamSimple,
};

export default anthropicMessages;
