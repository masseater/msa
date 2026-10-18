import { type AssistantMessage, type AssistantMessageEvent, normalizeContext } from "@msa/ai";
import { Effect, Stream } from "effect";

import { call } from "./call.ts";
import type { Emit } from "./tool-batch.ts";
import type { AgentContext, AgentLoopConfig, StreamFn } from "./types.ts";

export interface AssistantRequest {
  readonly context: AgentContext;
  readonly config: AgentLoopConfig;
  readonly signal: AbortSignal | undefined;
  readonly emit: Emit;
  readonly streamFunction: StreamFn;
}

const resolveApiKey = (config: AgentLoopConfig): Effect.Effect<string | undefined> => {
  const { getApiKey } = config;
  if (getApiKey === undefined) return Effect.succeed(config.apiKey);
  return Effect.map(
    call(() => getApiKey(config.model.provider)),
    (key) => (key === undefined || key === "" ? config.apiKey : key),
  );
};

const openResponse = ({ context, config, signal, streamFunction }: AssistantRequest) =>
  Effect.gen(function* () {
    const { transformContext } = config;
    const messages =
      transformContext === undefined
        ? context.messages
        : yield* call(() => transformContext(context.messages, signal));
    const llmMessages = yield* call(() => config.convertToLlm(messages));
    const llmContext = normalizeContext({ messages: llmMessages });
    const resolvedApiKey = yield* resolveApiKey(config);
    const { signal: _configSignal, ...streamConfig } = config;
    return yield* call(() =>
      streamFunction(config.model, llmContext, {
        ...streamConfig,
        ...(resolvedApiKey === undefined ? {} : { apiKey: resolvedApiKey }),
        ...(signal === undefined ? {} : { signal }),
      }),
    );
  });

type PartialState = { message: AssistantMessage | undefined; added: boolean };

type TerminalEvent = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

const isTerminal = (event: AssistantMessageEvent): event is TerminalEvent =>
  event.type === "done" || event.type === "error";

const onEvent = (
  request: AssistantRequest,
  partial: PartialState,
  event: AssistantMessageEvent,
): Effect.Effect<void> => {
  const { context, emit } = request;
  if (event.type === "start") {
    partial.message = event.partial;
    context.messages.push(event.partial);
    partial.added = true;
    return emit({ type: "message_start", message: { ...event.partial } });
  }
  if (isTerminal(event) || partial.message === undefined) return Effect.void;
  partial.message = event.partial;
  context.messages[context.messages.length - 1] = event.partial;
  return emit({
    type: "message_update",
    assistantMessageEvent: event,
    message: { ...event.partial },
  });
};

export const streamAssistantResponse = (
  request: AssistantRequest,
): Effect.Effect<AssistantMessage> =>
  Effect.gen(function* () {
    const { context, config, emit } = request;
    const response = yield* openResponse(request);
    const partial: PartialState = { message: undefined, added: false };
    yield* Stream.fromAsyncIterable(response, (error) => error).pipe(
      Stream.takeUntil(isTerminal),
      Stream.runForEach((event) => onEvent(request, partial, event)),
      Effect.orDie,
    );
    const finalMessage = Object.assign(yield* call(() => response.result()), {
      thinkingLevel: config.reasoning ?? "off",
    });
    if (partial.added) {
      context.messages[context.messages.length - 1] = finalMessage;
    } else {
      context.messages.push(finalMessage);
      yield* emit({ type: "message_start", message: { ...finalMessage } });
    }
    yield* emit({ type: "message_end", message: finalMessage });
    return finalMessage;
  });
