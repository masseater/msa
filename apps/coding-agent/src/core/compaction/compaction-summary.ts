import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import { Effect, Function as Fn } from "effect";

import messagesModule from "../messages.ts";
import platform from "../platform/index.ts";
import compactionPrompts from "./compaction-prompts.ts";
import type compactionSummaryTypes from "./compaction-summary.types.ts";
import summarizationCall from "./summarization-call.ts";
import utils from "./utils.ts";

const { ToolFailure, fromPromise, unwrapForeign } = platform;
const { serializeConversation } = utils;
const {
  buildSummarizationContext,
  completeSummarization,
  createSummarizationOptions,
  getSummarizationFailure,
} = summarizationCall;
const { SUMMARIZATION_PROMPT, TURN_PREFIX_SUMMARIZATION_PROMPT, UPDATE_SUMMARIZATION_PROMPT } =
  compactionPrompts;
const { convertToLlm } = messagesModule;

const { contentText } = ai;

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
