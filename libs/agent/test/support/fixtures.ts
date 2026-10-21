import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect, Stream } from "effect";
import { type TSchema, Type } from "typebox";

import type typesModule from "../../src/types.ts";
import type fixturesTypes from "./fixtures.types.ts";

const { createAssistantMessageEventStream } = ai;

const createUsage = () => ({
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
});

const createModel = (): aiTypes.Model<"openai-responses"> => ({
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

const createAssistantMessage = (
  content: aiTypes.AssistantMessage["content"],
): aiTypes.AssistantMessage => ({
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
  (stopReason: aiTypes.AssistantMessage["stopReason"]) =>
  (message: aiTypes.AssistantMessage): aiTypes.AssistantMessage => ({ ...message, stopReason });

const createUserMessage = (text: string): aiTypes.UserMessage => ({
  content: text,
  role: "user",
  timestamp: now(),
});

const identityConverter = (messages: typesModule.AgentMessage[]): aiTypes.Message[] =>
  messages.filter(
    (message) =>
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult",
  ) as aiTypes.Message[];

const textMessage = (text: string): aiTypes.AssistantMessage =>
  createAssistantMessage([{ text, type: "text" }]);

const toolCall = ({
  id,
  name = "echo",
  args = {},
}: fixturesTypes.CallSpec): typesModule.AgentToolCall => ({
  arguments: args,
  id,
  name,
  type: "toolCall",
});

const toolCallMessage = (calls: readonly fixturesTypes.CallSpec[]): aiTypes.AssistantMessage =>
  stoppedWith("toolUse")(createAssistantMessage(calls.map(toolCall)));

const respond = (message: aiTypes.AssistantMessage): aiTypes.AssistantMessageEventStream => {
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

const scripted = (...messages: aiTypes.AssistantMessage[]): fixturesTypes.Script => {
  let calls = 0;
  const contexts: aiTypes.TranscriptContext[] = [];
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
): typesModule.AgentTool<T, any> => ({
  description: `${options.name ?? "Echo"} tool`,
  execute: options.run,
  label: options.name ?? "Echo",
  name: options.name ?? "echo",
  parameters: options.parameters ?? (echoSchema as unknown as T),
  ...(options.executionMode === undefined ? {} : { executionMode: options.executionMode }),
});

const echoResult = (value: string): typesModule.AgentToolResult<{ value: string }> => ({
  content: [{ text: `echoed: ${value}`, type: "text" }],
  details: { value },
});

const collect = (
  stream: aiTypes.EventStream<typesModule.AgentEvent, typesModule.AgentMessage[]>,
): Effect.Effect<fixturesTypes.Collected> =>
  Effect.gen(function* () {
    const events = yield* Stream.runCollect(
      Stream.fromAsyncIterable(stream, (error) => error as Error),
    ).pipe(Effect.orDie);
    const messages = yield* Effect.promise(() => stream.result());
    return { events: [...events], messages };
  });

const toolResultIds = (events: readonly typesModule.AgentEvent[]): string[] =>
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
