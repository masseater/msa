import type { AgentMessage, StreamFn, ThinkingLevel } from "@msa/agent-core";
import {
  contentText,
  normalizeContext,
  type RetryCallbacks,
  type RetryPolicy,
  retryAssistantCall,
  uuidv7,
} from "@msa/ai";
import type {
  AssistantMessage,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
  Usage,
} from "@msa/ai/compat";
import { completeSimple } from "@msa/ai/compat";
import { Effect, Function as Fn } from "effect";

import { convertToLlm } from "../messages.ts";
import {
  currentTimeMillis,
  fromPromise,
  platformRuntime,
  ToolFailure,
  unwrapForeign,
} from "../platform/index.ts";
import {
  SUMMARIZATION_PROMPT,
  TURN_PREFIX_SUMMARIZATION_PROMPT,
  UPDATE_SUMMARIZATION_PROMPT,
} from "./compaction-prompts.ts";
import { SUMMARIZATION_SYSTEM_PROMPT, serializeConversation } from "./utils.ts";

const getSummarizationFailureImpl = (
  response: AssistantMessage,
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

export const getSummarizationFailure: {
  (label: string): (response: AssistantMessage) => string | undefined;
  (response: AssistantMessage, label: string): string | undefined;
} = Fn.dual(2, getSummarizationFailureImpl);

interface SummarizationOptionsInput {
  model: Model<any>;
  maxTokens: number;
  apiKey: string | undefined;
  headers: Record<string, string> | undefined;
  env: Record<string, string> | undefined;
  signal: AbortSignal | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  sessionId: string | undefined;
}

function createSummarizationOptions(input: SummarizationOptionsInput): SimpleStreamOptions {
  const { model, maxTokens, apiKey, headers, env, signal, thinkingLevel, sessionId } = input;
  const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers, env, sessionId };
  if (model.reasoning && thinkingLevel !== undefined && thinkingLevel !== "off") {
    options.reasoning = thinkingLevel;
  }
  return options;
}

type CompleteRest = [
  context: TranscriptContext,
  options: SimpleStreamOptions,
  streamFn?: StreamFn,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks,
];

const completeSummarizationImpl = (
  model: Model<any>,
  ...[context, options, streamFn, retry, callbacks]: CompleteRest
): Promise<AssistantMessage> => {
  const requestOptions: SimpleStreamOptions = {
    ...options,
    cacheRetention: "none",
    sessionId: options.sessionId ?? uuidv7(),
  };
  const produce = (): Promise<AssistantMessage> =>
    streamFn === undefined
      ? completeSimple(model, context, requestOptions)
      : platformRuntime.runPromise(
          unwrapForeign(
            fromPromise(() => streamFn(model, context, requestOptions)).pipe(
              Effect.flatMap((stream) => fromPromise(() => stream.result())),
            ),
          ),
        );
  return retryAssistantCall(produce, retry, requestOptions.signal, callbacks);
};

export const completeSummarization: {
  (...rest: CompleteRest): (model: Model<any>) => Promise<AssistantMessage>;
  (model: Model<any>, ...rest: CompleteRest): Promise<AssistantMessage>;
} = Fn.dual((args) => !("messages" in (args[0] as object)), completeSummarizationImpl);

export type SummaryRest = [
  model: Model<any>,
  reserveTokens: number,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
  env?: Record<string, string>,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks,
  sessionId?: string,
];

function buildSummarizationContext(promptText: string): TranscriptContext {
  return normalizeContext({
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: promptText }],
        timestamp: currentTimeMillis(),
      },
    ],
  });
}

const maxSummaryTokens = (model: Model<any>, reserveTokens: number, share: number): number =>
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

const requireSummary = (response: AssistantMessage, label: string, toolMessage: string) =>
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
  currentMessages: AgentMessage[],
  ...rest: SummaryRest
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
  const promptText = buildSummaryPrompt({ conversationText, previousSummary, customInstructions });
  const response = yield* fromPromise(() =>
    completeSummarization(
      model,
      buildSummarizationContext(promptText),
      createSummarizationOptions({
        model,
        maxTokens: maxSummaryTokens(model, reserveTokens, 0.8),
        apiKey,
        headers,
        env,
        signal,
        thinkingLevel,
        sessionId,
      }),
      streamFn,
      retry,
      callbacks,
    ),
  );
  return yield* requireSummary(response, "Summarization", "Summarization attempted to call a tool");
});

const generateSummaryWithUsageImpl = (
  currentMessages: AgentMessage[],
  ...rest: SummaryRest
): Promise<{ text: string; usage: Usage }> =>
  platformRuntime.runPromise(unwrapForeign(summaryWithUsage(currentMessages, ...rest)));

export const generateSummaryWithUsage: {
  (
    ...rest: SummaryRest
  ): (currentMessages: AgentMessage[]) => Promise<{ text: string; usage: Usage }>;
  (currentMessages: AgentMessage[], ...rest: SummaryRest): Promise<{ text: string; usage: Usage }>;
} = Fn.dual((args) => Array.isArray(args[0]), generateSummaryWithUsageImpl);

const generateSummaryImpl = (
  currentMessages: AgentMessage[],
  ...rest: SummaryRest
): Promise<string> =>
  platformRuntime.runPromise(
    unwrapForeign(summaryWithUsage(currentMessages, ...rest).pipe(Effect.map(({ text }) => text))),
  );

export const generateSummary: {
  (...rest: SummaryRest): (currentMessages: AgentMessage[]) => Promise<string>;
  (currentMessages: AgentMessage[], ...rest: SummaryRest): Promise<string>;
} = Fn.dual((args) => Array.isArray(args[0]), generateSummaryImpl);

export interface TurnPrefixInput {
  messages: AgentMessage[];
  model: Model<any>;
  reserveTokens: number;
  apiKey: string | undefined;
  headers: Record<string, string> | undefined;
  env: Record<string, string> | undefined;
  signal: AbortSignal | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  streamFn: StreamFn | undefined;
  retry: RetryPolicy | undefined;
  callbacks: RetryCallbacks | undefined;
  sessionId: string | undefined;
}

export const generateTurnPrefixSummary = Effect.fn("generateTurnPrefixSummary")(function* (
  input: TurnPrefixInput,
) {
  const { messages, model, reserveTokens, streamFn, retry, callbacks } = input;
  const conversationText = serializeConversation(convertToLlm(messages));
  const promptText = `# Conversation\n${conversationText}\n\n# Instructions\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
  const response = yield* fromPromise(() =>
    completeSummarization(
      model,
      buildSummarizationContext(promptText),
      createSummarizationOptions({
        model,
        maxTokens: maxSummaryTokens(model, reserveTokens, 0.5),
        apiKey: input.apiKey,
        headers: input.headers,
        env: input.env,
        signal: input.signal,
        thinkingLevel: input.thinkingLevel,
        sessionId: input.sessionId,
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

export { summaryWithUsage };
