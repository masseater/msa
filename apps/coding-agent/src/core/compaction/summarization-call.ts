import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect, Function as Fn } from "effect";

import platform from "../platform/index.ts";
import utils from "./utils.ts";

const { currentTimeMillis, fromPromise, unwrapForeign } = platform;
const { SUMMARIZATION_SYSTEM_PROMPT } = utils;
const { normalizeContext, retryAssistantCall, uuidv7 } = ai;
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

const summarizationCall = {
  buildSummarizationContext,
  completeSummarization,
  createSummarizationOptions,
  getSummarizationFailure,
};

export default summarizationCall;
