import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@msa/ai";
import { Clock, Data, Effect, Stream } from "effect";
import { dual } from "effect/Function";

import { isOAuthToken } from "./auth.ts";
import { convertMessages, convertTools, sanitizeSurrogates } from "./convert.ts";
import { handleEvent } from "./stream-events.ts";

class AnthropicStreamError extends Data.TaggedError("AnthropicStreamError")<{
  readonly message: string;
}> {}

const initialOutput = (model: Model<Api>, timestamp: number): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "pending",
  timestamp,
});

const buildClient = (model: Model<Api>, apiKey: string, isOAuth: boolean): Anthropic => {
  const betaFeatures = [
    "fine-grained-tool-streaming-2025-05-14",
    "interleaved-thinking-2025-05-14",
  ];

  if (isOAuth) {
    return new Anthropic({
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      apiKey: null,
      authToken: apiKey,
      defaultHeaders: {
        accept: "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": `claude-code-20250219,oauth-2025-04-20,${betaFeatures.join(",")}`,
        "user-agent": "claude-cli/2.1.2 (external, cli)",
        "x-app": "cli",
      },
    });
  }

  return new Anthropic({
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    apiKey,
    defaultHeaders: {
      accept: "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-beta": betaFeatures.join(","),
    },
  });
};

const buildSystem = (systemPrompt: string, isOAuth: boolean) => {
  const blocks: { type: "text"; text: string; cache_control: { type: "ephemeral" } }[] = [];
  if (isOAuth) {
    blocks.push({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
      cache_control: { type: "ephemeral" },
    });
  }
  if (systemPrompt.length > 0) {
    blocks.push({
      type: "text",
      text: sanitizeSurrogates(systemPrompt),
      cache_control: { type: "ephemeral" },
    });
  }
  return blocks;
};

const buildThinking = (options: SimpleStreamOptions, model: Model<Api>) => {
  if (options.reasoning === undefined || !model.reasoning) return undefined;

  const defaultBudgets: Record<string, number> = {
    minimal: 1024,
    low: 4096,
    medium: 10240,
    high: 20480,
  };
  const budgets = options.thinkingBudgets as Record<string, number | undefined> | undefined;
  const customBudget = budgets?.[options.reasoning];
  return {
    type: "enabled" as const,
    budget_tokens: customBudget ?? defaultBudgets[options.reasoning] ?? 10240,
  };
};

const buildParams = (
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
  isOAuth: boolean,
): MessageCreateParamsStreaming => {
  const transcript = collapseSystemMessages(context);
  const systemPrompt = getCurrentSystemPrompt(transcript.messages);
  const tools = getCurrentTools(transcript.messages);

  const params: MessageCreateParamsStreaming = {
    model: model.id,
    messages: convertMessages({
      messages: transcript.messages,
      isOAuth,
    }) as MessageCreateParamsStreaming["messages"],
    max_tokens: options?.maxTokens ?? Math.floor(model.maxTokens / 3),
    stream: true,
  };

  const system = buildSystem(systemPrompt, isOAuth);
  if (system.length > 0) params.system = system;
  const convertedTools = convertTools({ tools, isOAuth }) as NonNullable<
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

const finish = (stream: AssistantMessageEventStream, output: AssistantMessage): void => {
  if (output.stopReason === "pending") {
    throw new Error("Anthropic stream ended without a stop reason");
  }
  if (output.stopReason === "error" || output.stopReason === "aborted") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
  stream.push({ type: "done", reason: output.stopReason, message: output });
  stream.end();
};

const runStream = (
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
) =>
  Effect.gen(function* () {
    const apiKey = options?.apiKey ?? "";
    const isOAuth = isOAuthToken(apiKey);
    const tools = getCurrentTools(collapseSystemMessages(context).messages);
    const client = buildClient(model, apiKey, isOAuth);
    const params = buildParams(model, context, options, isOAuth);

    const anthropicStream = client.messages.stream(params, { signal: options?.signal });
    stream.push({ type: "start", partial: output });

    yield* Stream.runForEach(
      Stream.fromAsyncIterable(
        anthropicStream,
        (cause) => new AnthropicStreamError({ message: String(cause) }),
      ),
      (event) => Effect.sync(() => handleEvent({ stream, output, model, tools, isOAuth, event })),
    );

    if (options?.signal?.aborted === true) {
      return yield* new AnthropicStreamError({ message: "Request was aborted" });
    }
    finish(stream, output);
  });

const streamCustomAnthropicImpl = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
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
          stream.push({ type: "error", reason: output.stopReason, error: output });
          stream.end();
        }),
      ),
    ),
  );

  return stream;
};

export const streamCustomAnthropic: {
  (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  (
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): (model: Model<Api>) => AssistantMessageEventStream;
} = dual((args: IArguments) => args.length >= 2, streamCustomAnthropicImpl);
