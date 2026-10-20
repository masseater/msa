import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type EventStream,
  type Message,
  type Model,
  type TranscriptContext,
  type UserMessage,
  createAssistantMessageEventStream,
} from "@msa/ai";
import { Effect, Stream } from "effect";
import { type TSchema, Type } from "typebox";

import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
} from "../../src/types.ts";
import type fixturesTypes from "./fixtures.types.ts";

const createUsage = () => ({
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
});

const createModel = (): Model<"openai-responses"> => ({
  api: "openai-responses",
  baseUrl: "https://example.invalid",
  contextWindow: 8192,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "mock",
  input: ["text"],
  maxTokens: 2048,
  name: "mock",
  provider: "openai",
  reasoning: false,
});

const now = (): number => Effect.runSync(Effect.clockWith((clock) => clock.currentTimeMillis));

const createAssistantMessage = (content: AssistantMessage["content"]): AssistantMessage => ({
  api: "openai-responses",
  content,
  model: "mock",
  provider: "openai",
  role: "assistant",
  stopReason: "stop",
  timestamp: now(),
  usage: createUsage(),
});

const stoppedWith =
  (stopReason: AssistantMessage["stopReason"]) =>
  (message: AssistantMessage): AssistantMessage => ({ ...message, stopReason });

const createUserMessage = (text: string): UserMessage => ({
  content: text,
  role: "user",
  timestamp: now(),
});

const identityConverter = (messages: AgentMessage[]): Message[] =>
  messages.filter(
    (message) =>
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult",
  ) as Message[];

const textMessage = (text: string): AssistantMessage =>
  createAssistantMessage([{ text, type: "text" }]);

const toolCall = ({ id, name = "echo", args = {} }: fixturesTypes.CallSpec): AgentToolCall => ({
  arguments: args,
  id,
  name,
  type: "toolCall",
});

const toolCallMessage = (calls: readonly fixturesTypes.CallSpec[]): AssistantMessage =>
  stoppedWith("toolUse")(createAssistantMessage(calls.map(toolCall)));

const respond = (message: AssistantMessage): AssistantMessageEventStream => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      stream.push({ error: message, reason: message.stopReason, type: "error" });
    } else {
      stream.push({
        message,
        reason: message.stopReason as "stop" | "length" | "toolUse",
        type: "done",
      });
    }
  });
  return stream;
};

const scripted = (...messages: AssistantMessage[]): fixturesTypes.Script => {
  let calls = 0;
  const contexts: TranscriptContext[] = [];
  return {
    calls: () => calls,
    contexts,
    streamFn: (_model, context) => {
      contexts.push(context);
      const message = messages[Math.min(calls, messages.length - 1)] ?? textMessage("done");
      calls++;
      return respond(message);
    },
  };
};

const echoSchema = Type.Object({ value: Type.String() });

const tool = <T extends TSchema = typeof echoSchema>(
  options: fixturesTypes.EchoOptions<T>,
): AgentTool<T, any> => ({
  description: `${options.name ?? "Echo"} tool`,
  execute: options.run,
  label: options.name ?? "Echo",
  name: options.name ?? "echo",
  parameters: options.parameters ?? (echoSchema as unknown as T),
  ...(options.executionMode === undefined ? {} : { executionMode: options.executionMode }),
});

const echoResult = (value: string): AgentToolResult<{ value: string }> => ({
  content: [{ text: `echoed: ${value}`, type: "text" }],
  details: { value },
});

const collect = (
  stream: EventStream<AgentEvent, AgentMessage[]>,
): Effect.Effect<fixturesTypes.Collected> =>
  Effect.gen(function* () {
    const events = yield* Stream.runCollect(
      Stream.fromAsyncIterable(stream, (error) => error as Error),
    ).pipe(Effect.orDie);
    const messages = yield* Effect.promise(() => stream.result());
    return { events: [...events], messages };
  });

const toolResultIds = (events: readonly AgentEvent[]): string[] =>
  events.flatMap((event) =>
    event.type === "message_end" && event.message.role === "toolResult"
      ? [event.message.toolCallId]
      : [],
  );

const delayed =
  (millis: number) =>
  <A>(value: A): Promise<A> =>
    Effect.runPromise(Effect.as(Effect.sleep(millis), value));

const fixtures = {
  collect,
  createAssistantMessage,
  createModel,
  createUsage,
  createUserMessage,
  delayed,
  echoResult,
  echoSchema,
  identityConverter,
  now,
  respond,
  scripted,
  stoppedWith,
  textMessage,
  tool,
  toolCall,
  toolCallMessage,
  toolResultIds,
};

export default fixtures;
