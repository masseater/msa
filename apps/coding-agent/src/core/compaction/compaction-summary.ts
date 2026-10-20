import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect, Function as Fn } from "effect";

import messagesModule from "../messages.ts";
import platform from "../platform/index.ts";
import compactionPrompts from "./compaction-prompts.ts";
import type compactionSummaryTypes from "./compaction-summary.types.ts";
import utils from "./utils.ts";

const { ToolFailure, currentTimeMillis, fromPromise, unwrapForeign } = platform;
const { SUMMARIZATION_SYSTEM_PROMPT, serializeConversation } = utils;
const { SUMMARIZATION_PROMPT, TURN_PREFIX_SUMMARIZATION_PROMPT, UPDATE_SUMMARIZATION_PROMPT } =
  compactionPrompts;
const { convertToLlm } = messagesModule;

const { contentText, normalizeContext, retryAssistantCall, uuidv7 } = ai;
const { completeSimple } = compat;

const getSummarizationFailureImpl = (
  response: compatTypes.AssistantMessage,
  label: string,
): string | undefined => {
  if (response.stopReason === "error") {
    return `${label} failed: ${response.errorMessage || "Unknown error"}`;
  }
  if (response.stopReason === "length") {
    return `${label} failed: generation hit the token cap and the summary is incomplete`;
  }
  return undefined;
};

const getSummarizationFailure: {
  (label: string): (response: compatTypes.AssistantMessage) => string | undefined;
  (response: compatTypes.AssistantMessage, label: string): string | undefined;
} = Fn.dual(2, getSummarizationFailureImpl);

interface SummarizationOptionsInput {
  model: compatTypes.Model<any>;
  maxTokens: number;
  apiKey: string | undefined;
  headers: Record<string, string> | undefined;
  env: Record<string, string> | undefined;
  signal: AbortSignal | undefined;
  thinkingLevel: agentTypes.ThinkingLevel | undefined;
  sessionId: string | undefined;
}

function createSummarizationOptions(
  input: SummarizationOptionsInput,
): compatTypes.SimpleStreamOptions {
  const { model, maxTokens, apiKey, headers, env, signal, thinkingLevel, sessionId } = input;
  const options: compatTypes.SimpleStreamOptions = {
    apiKey,
    env,
    headers,
    maxTokens,
    sessionId,
    signal,
  };
  if (model.reasoning && thinkingLevel !== undefined && thinkingLevel !== "off") {
    options.reasoning = thinkingLevel;
  }
  return options;
}

type CompleteRest = [
  context: compatTypes.TranscriptContext,
  options: compatTypes.SimpleStreamOptions,
  streamFn?: agentTypes.StreamFn,
  retry?: aiTypes.RetryPolicy,
  callbacks?: aiTypes.RetryCallbacks,
];

const completeSummarizationImpl = (
  model: compatTypes.Model<any>,
  ...[context, options, streamFn, retry, callbacks]: CompleteRest
): Promise<compatTypes.AssistantMessage> => {
  const requestOptions: compatTypes.SimpleStreamOptions = {
    ...options,
    cacheRetention: "none",
    sessionId: options.sessionId ?? uuidv7(),
  };
  const produce = (): Promise<compatTypes.AssistantMessage> =>
    streamFn === undefined
      ? completeSimple(model, context, requestOptions)
      : Effect.runPromise(
          unwrapForeign(
            fromPromise(() => streamFn(model, context, requestOptions)).pipe(
              Effect.flatMap((stream) => fromPromise(() => stream.result())),
            ),
          ),
        );
  return retryAssistantCall(produce, retry, requestOptions.signal, callbacks);
};

const completeSummarization: {
  (...rest: CompleteRest): (model: compatTypes.Model<any>) => Promise<compatTypes.AssistantMessage>;
  (model: compatTypes.Model<any>, ...rest: CompleteRest): Promise<compatTypes.AssistantMessage>;
} = Fn.dual((args) => !("messages" in (args[0] as object)), completeSummarizationImpl);

function buildSummarizationContext(promptText: string): compatTypes.TranscriptContext {
  return normalizeContext({
    messages: [
      {
        content: [{ text: promptText, type: "text" }],
        role: "user",
        timestamp: currentTimeMillis(),
      },
    ],
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
  });
}

const maxSummaryTokens = (
  model: compatTypes.Model<any>,
  reserveTokens: number,
  share: number,
): number =>
  Math.min(
    Math.floor(share * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );

interface SummaryPromptInput {
  conversationText: string;
  previousSummary: string | undefined;
  customInstructions: string | undefined;
}

function buildSummaryPrompt({
  conversationText,
  previousSummary,
  customInstructions,
}: SummaryPromptInput): string {
  const hasPrevious = previousSummary !== undefined && previousSummary !== "";
  let basePrompt = hasPrevious ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions !== undefined && customInstructions !== "") {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (hasPrevious) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  return promptText + basePrompt;
}

const requireSummary = (
  response: compatTypes.AssistantMessage,
  label: string,
  toolMessage: string,
) =>
  Effect.gen(function* () {
    const failure = getSummarizationFailure(response, label);
    if (failure !== undefined && failure !== "") {
      return yield* new ToolFailure({ message: failure });
    }
    if (response.content.some((block) => block.type === "toolCall")) {
      return yield* new ToolFailure({ message: toolMessage });
    }
    return { text: contentText(response.content, "\n"), usage: response.usage };
  });

const summaryWithUsage = Effect.fn("generateSummaryWithUsage")(function* (
  currentMessages: agentTypes.AgentMessage[],
  ...rest: compactionSummaryTypes.SummaryRest
) {
  const [
    model,
    reserveTokens,
    apiKey,
    headers,
    signal,
    customInstructions,
    previousSummary,
    thinkingLevel,
    streamFn,
    env,
    retry,
    callbacks,
    sessionId,
  ] = rest;
  const conversationText = serializeConversation(convertToLlm(currentMessages));
  const promptText = buildSummaryPrompt({ conversationText, customInstructions, previousSummary });
  const response = yield* fromPromise(() =>
    completeSummarization(
      model,
      buildSummarizationContext(promptText),
      createSummarizationOptions({
        apiKey,
        env,
        headers,
        maxTokens: maxSummaryTokens(model, reserveTokens, 0.8),
        model,
        sessionId,
        signal,
        thinkingLevel,
      }),
      streamFn,
      retry,
      callbacks,
    ),
  );
  return yield* requireSummary(response, "Summarization", "Summarization attempted to call a tool");
});

const generateSummaryWithUsageImpl = (
  currentMessages: agentTypes.AgentMessage[],
  ...rest: compactionSummaryTypes.SummaryRest
): Promise<{ text: string; usage: compatTypes.Usage }> =>
  Effect.runPromise(unwrapForeign(summaryWithUsage(currentMessages, ...rest)));

const generateSummaryWithUsage: {
  (
    ...rest: compactionSummaryTypes.SummaryRest
  ): (
    currentMessages: agentTypes.AgentMessage[],
  ) => Promise<{ text: string; usage: compatTypes.Usage }>;
  (
    currentMessages: agentTypes.AgentMessage[],
    ...rest: compactionSummaryTypes.SummaryRest
  ): Promise<{ text: string; usage: compatTypes.Usage }>;
} = Fn.dual((args) => Array.isArray(args[0]), generateSummaryWithUsageImpl);

const generateSummaryImpl = (
  currentMessages: agentTypes.AgentMessage[],
  ...rest: compactionSummaryTypes.SummaryRest
): Promise<string> =>
  Effect.runPromise(
    unwrapForeign(summaryWithUsage(currentMessages, ...rest).pipe(Effect.map(({ text }) => text))),
  );

const generateSummary: {
  (
    ...rest: compactionSummaryTypes.SummaryRest
  ): (currentMessages: agentTypes.AgentMessage[]) => Promise<string>;
  (
    currentMessages: agentTypes.AgentMessage[],
    ...rest: compactionSummaryTypes.SummaryRest
  ): Promise<string>;
} = Fn.dual((args) => Array.isArray(args[0]), generateSummaryImpl);

const generateTurnPrefixSummary = Effect.fn("generateTurnPrefixSummary")(function* (
  input: compactionSummaryTypes.TurnPrefixInput,
) {
  const { messages, model, reserveTokens, streamFn, retry, callbacks } = input;
  const conversationText = serializeConversation(convertToLlm(messages));
  const promptText = `# Conversation\n${conversationText}\n\n# Instructions\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
  const response = yield* fromPromise(() =>
    completeSummarization(
      model,
      buildSummarizationContext(promptText),
      createSummarizationOptions({
        apiKey: input.apiKey,
        env: input.env,
        headers: input.headers,
        maxTokens: maxSummaryTokens(model, reserveTokens, 0.5),
        model,
        sessionId: input.sessionId,
        signal: input.signal,
        thinkingLevel: input.thinkingLevel,
      }),
      streamFn,
      retry,
      callbacks,
    ),
  );
  return yield* requireSummary(
    response,
    "Turn prefix summarization",
    "Turn prefix summarization attempted to call a tool",
  );
});

const compactionSummary = {
  completeSummarization,
  generateSummary,
  generateSummaryWithUsage,
  generateTurnPrefixSummary,
  getSummarizationFailure,
  summaryWithUsage,
};

export default compactionSummary;
