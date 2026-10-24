import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Clock, Effect, Schema, Stream } from "effect";
import { dual } from "effect/Function";

import auth from "./auth.ts";
import convert from "./convert.ts";
import streamEvents from "./stream-events.ts";

const { convertMessages, convertTools, sanitizeSurrogates } = convert;
const { isOAuthToken } = auth;
const { handleEvent } = streamEvents;

const {
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
} = ai;

class AnthropicStreamError extends Schema.TaggedError<
  AnthropicStreamError,
  { readonly brand: unique symbol }
>()("AnthropicStreamError", { message: Schema.String }) {}

const initialOutput = (
  model: aiTypes.Model<aiTypes.Api>,
  timestamp: number,
): aiTypes.AssistantMessage => ({
  api: model.api,
  content: [],
  model: model.id,
  provider: model.provider,
  role: "assistant",
  stopReason: "pending",
  timestamp,
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  },
});

const buildClient = (
  model: aiTypes.Model<aiTypes.Api>,
  apiKey: string,
  isOAuth: boolean,
): Anthropic => {
  const betaFeatures = [
    "fine-grained-tool-streaming-2025-05-14",
    "interleaved-thinking-2025-05-14",
  ];

  if (isOAuth) {
    return new Anthropic({
      apiKey: null,
      authToken: apiKey,
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        accept: "application/json",
        "anthropic-beta": `claude-code-20250219,oauth-2025-04-20,${betaFeatures.join(",")}`,
        "anthropic-dangerous-direct-browser-access": "true",
        "user-agent": "claude-cli/2.1.2 (external, cli)",
        "x-app": "cli",
      },
    });
  }

  return new Anthropic({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      accept: "application/json",
      "anthropic-beta": betaFeatures.join(","),
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
};

const buildSystem = (systemPrompt: string, isOAuth: boolean) => {
  const blocks: { type: "text"; text: string; cache_control: { type: "ephemeral" } }[] = [];
  if (isOAuth) {
    blocks.push({
      cache_control: { type: "ephemeral" },
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
      type: "text",
    });
  }
  if (systemPrompt.length > 0) {
    blocks.push({
      cache_control: { type: "ephemeral" },
      text: sanitizeSurrogates(systemPrompt),
      type: "text",
    });
  }
  return blocks;
};

const buildThinking = (options: aiTypes.SimpleStreamOptions, model: aiTypes.Model<aiTypes.Api>) => {
  if (options.reasoning === undefined || !model.reasoning) return undefined;

  const defaultBudgets: Record<string, number> = {
    high: 20480,
    low: 4096,
    medium: 10240,
    minimal: 1024,
  };
  const budgets = options.thinkingBudgets as Record<string, number | undefined> | undefined;
  const customBudget = budgets?.[options.reasoning];
  return {
    budget_tokens: customBudget ?? defaultBudgets[options.reasoning] ?? 10240,
    type: "enabled" as const,
  };
};

const buildParams = (
  model: aiTypes.Model<aiTypes.Api>,
  context: aiTypes.TranscriptContext,
  options: aiTypes.SimpleStreamOptions | undefined,
  isOAuth: boolean,
): MessageCreateParamsStreaming => {
  const transcript = collapseSystemMessages(context);
  const systemPrompt = getCurrentSystemPrompt(transcript.messages);
  const tools = getCurrentTools(transcript.messages);

  const params: MessageCreateParamsStreaming = {
    max_tokens: options?.maxTokens ?? Math.floor(model.maxTokens / 3),
    messages: convertMessages({
      isOAuth,
      messages: transcript.messages,
    }) as MessageCreateParamsStreaming["messages"],
    model: model.id,
    stream: true,
  };

  const system = buildSystem(systemPrompt, isOAuth);
  if (system.length > 0) params.system = system;
  const convertedTools = convertTools({ isOAuth, tools }) as NonNullable<
    MessageCreateParamsStreaming["tools"]
  >;
  if (convertedTools.length > 0) {
    params.tools = convertedTools;
  }

  if (options !== undefined) {
    const thinking = buildThinking(options, model);
    if (thinking !== undefined) params.thinking = thinking;
  }

  return params;
};

const finish = (
  stream: aiTypes.AssistantMessageEventStream,
  output: aiTypes.AssistantMessage,
): void => {
  if (output.stopReason === "pending") {
    throw new Error("Anthropic stream ended without a stop reason");
  }
  if (output.stopReason === "error" || output.stopReason === "aborted") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
  stream.push({ message: output, reason: output.stopReason, type: "done" });
  stream.end();
};

const runStream = (
  stream: aiTypes.AssistantMessageEventStream,
  output: aiTypes.AssistantMessage,
  model: aiTypes.Model<aiTypes.Api>,
  context: aiTypes.TranscriptContext,
  options: aiTypes.SimpleStreamOptions | undefined,
) =>
  Effect.gen(function* () {
    const apiKey = options?.apiKey ?? "";
    const isOAuth = isOAuthToken(apiKey);
    const tools = getCurrentTools(collapseSystemMessages(context).messages);
    const client = buildClient(model, apiKey, isOAuth);
    const params = buildParams(model, context, options, isOAuth);

    const anthropicStream = client.messages.stream(params, { signal: options?.signal });
    stream.push({ partial: output, type: "start" });

    yield* Stream.runForEach(
      Stream.fromAsyncIterable(anthropicStream, (cause) =>
        AnthropicStreamError.make({ message: String(cause) }),
      ),
      (event) => Effect.sync(() => handleEvent({ event, isOAuth, model, output, stream, tools })),
    );

    if (options?.signal?.aborted === true) {
      return yield* AnthropicStreamError.make({ message: "Request was aborted" });
    }
    finish(stream, output);
  });

const streamCustomAnthropicImpl = (
  model: aiTypes.Model<aiTypes.Api>,
  context: aiTypes.TranscriptContext,
  options?: aiTypes.SimpleStreamOptions,
): aiTypes.AssistantMessageEventStream => {
  const stream = createAssistantMessageEventStream();
  const output = initialOutput(model, Effect.runSync(Clock.currentTimeMillis));

  Effect.runFork(
    runStream(stream, output, model, context, options).pipe(
      Effect.catch((error: AnthropicStreamError) =>
        Effect.sync(() => {
          for (const block of output.content) {
            delete (block as { index?: number }).index;
          }
          output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
          output.errorMessage = error.message;
          stream.push({ error: output, reason: output.stopReason, type: "error" });
          stream.end();
        }),
      ),
    ),
  );

  return stream;
};

const streamCustomAnthropic: {
  (
    model: aiTypes.Model<aiTypes.Api>,
    context: aiTypes.TranscriptContext,
    options?: aiTypes.SimpleStreamOptions,
  ): aiTypes.AssistantMessageEventStream;
  (
    context: aiTypes.TranscriptContext,
    options?: aiTypes.SimpleStreamOptions,
  ): (model: aiTypes.Model<aiTypes.Api>) => aiTypes.AssistantMessageEventStream;
} = dual((args: IArguments) => args.length >= 2, streamCustomAnthropicImpl);

const stream = {
  streamCustomAnthropic,
};

export default stream;
