import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect, Stream } from "effect";

import type assistantResponseTypes from "./assistant-response.types.ts";
import callModule from "./call.ts";
import type typesModule from "./types.ts";

const { normalizeContext } = ai;

const { call } = callModule;

const resolveApiKey = (config: typesModule.AgentLoopConfig): Effect.Effect<string | undefined> => {
  const { getApiKey } = config;
  if (getApiKey === undefined) return Effect.succeed(config.apiKey);
  return Effect.map(
    call(() => getApiKey(config.model.provider)),
    (key) => (key === undefined || key === "" ? config.apiKey : key),
  );
};

const openResponse = ({
  context,
  config,
  signal,
  streamFunction,
}: assistantResponseTypes.AssistantRequest) =>
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

type PartialState = { message: aiTypes.AssistantMessage | undefined; added: boolean };

type TerminalEvent = Extract<aiTypes.AssistantMessageEvent, { type: "done" | "error" }>;

const isTerminal = (event: aiTypes.AssistantMessageEvent): event is TerminalEvent =>
  event.type === "done" || event.type === "error";

const onEvent = (
  request: assistantResponseTypes.AssistantRequest,
  partial: PartialState,
  event: aiTypes.AssistantMessageEvent,
): Effect.Effect<void> => {
  const { context, emit } = request;
  if (event.type === "start") {
    partial.message = event.partial;
    context.messages.push(event.partial);
    partial.added = true;
    return emit({ message: { ...event.partial }, type: "message_start" });
  }
  if (isTerminal(event) || partial.message === undefined) return Effect.void;
  partial.message = event.partial;
  context.messages[context.messages.length - 1] = event.partial;
  return emit({
    assistantMessageEvent: event,
    message: { ...event.partial },
    type: "message_update",
  });
};

const streamAssistantResponse = (
  request: assistantResponseTypes.AssistantRequest,
): Effect.Effect<aiTypes.AssistantMessage> =>
  Effect.gen(function* () {
    const { context, config, emit } = request;
    const response = yield* openResponse(request);
    const partial: PartialState = { added: false, message: undefined };
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
      yield* emit({ message: { ...finalMessage }, type: "message_start" });
    }
    yield* emit({ message: finalMessage, type: "message_end" });
    return finalMessage;
  });

const assistantResponse = {
  streamAssistantResponse,
};

export default assistantResponse;
