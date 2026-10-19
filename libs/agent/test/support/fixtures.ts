import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type EventStream,
  type Message,
  type Model,
  type TranscriptContext,
  type UserMessage,
} from "@msa/ai";
import { Effect, Stream } from "effect";
import { type TSchema, Type } from "typebox";

import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  StreamFn,
} from "../../src/types.ts";

export const createUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export const createModel = (): Model<"openai-responses"> => ({
  id: "mock",
  name: "mock",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 2048,
});

export const now = (): number =>
  Effect.runSync(Effect.clockWith((clock) => clock.currentTimeMillis));

export const createAssistantMessage = (content: AssistantMessage["content"]): AssistantMessage => ({
  role: "assistant",
  content,
  api: "openai-responses",
  provider: "openai",
  model: "mock",
  usage: createUsage(),
  stopReason: "stop",
  timestamp: now(),
});

export const stoppedWith =
  (stopReason: AssistantMessage["stopReason"]) =>
  (message: AssistantMessage): AssistantMessage => ({ ...message, stopReason });

export const createUserMessage = (text: string): UserMessage => ({
  role: "user",
  content: text,
  timestamp: now(),
});

export const identityConverter = (messages: AgentMessage[]): Message[] =>
  messages.filter(
    (message) =>
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult",
  ) as Message[];

export const textMessage = (text: string): AssistantMessage =>
  createAssistantMessage([{ type: "text", text }]);

export interface CallSpec {
  readonly id: string;
  readonly name?: string;
  readonly args?: AgentToolCall["arguments"];
}

export const toolCall = ({ id, name = "echo", args = {} }: CallSpec): AgentToolCall => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

export const toolCallMessage = (calls: readonly CallSpec[]): AssistantMessage =>
  stoppedWith("toolUse")(createAssistantMessage(calls.map(toolCall)));

export const respond = (message: AssistantMessage): AssistantMessageEventStream => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      stream.push({ type: "error", reason: message.stopReason, error: message });
    } else {
      stream.push({
        type: "done",
        reason: message.stopReason as "stop" | "length" | "toolUse",
        message,
      });
    }
  });
  return stream;
};

export interface Script {
  readonly streamFn: StreamFn;
  readonly calls: () => number;
  readonly contexts: TranscriptContext[];
}

export const scripted = (...messages: AssistantMessage[]): Script => {
  let calls = 0;
  const contexts: TranscriptContext[] = [];
  return {
    streamFn: (_model, context) => {
      contexts.push(context);
      const message = messages[Math.min(calls, messages.length - 1)] ?? textMessage("done");
      calls++;
      return respond(message);
    },
    calls: () => calls,
    contexts,
  };
};

export const echoSchema = Type.Object({ value: Type.String() });

export interface EchoOptions<T extends TSchema> {
  readonly name?: string;
  readonly parameters?: T;
  readonly executionMode?: AgentTool["executionMode"];
  readonly run: AgentTool<T, any>["execute"];
}

export const tool = <T extends TSchema = typeof echoSchema>(
  options: EchoOptions<T>,
): AgentTool<T, any> => ({
  name: options.name ?? "echo",
  label: options.name ?? "Echo",
  description: `${options.name ?? "Echo"} tool`,
  parameters: options.parameters ?? (echoSchema as unknown as T),
  ...(options.executionMode === undefined ? {} : { executionMode: options.executionMode }),
  execute: options.run,
});

export const echoResult = (value: string): AgentToolResult<{ value: string }> => ({
  content: [{ type: "text", text: `echoed: ${value}` }],
  details: { value },
});

export interface Collected {
  readonly events: AgentEvent[];
  readonly messages: AgentMessage[];
}

export const collect = (
  stream: EventStream<AgentEvent, AgentMessage[]>,
): Effect.Effect<Collected> =>
  Effect.gen(function* () {
    const events = yield* Stream.runCollect(
      Stream.fromAsyncIterable(stream, (error) => error as Error),
    ).pipe(Effect.orDie);
    const messages = yield* Effect.promise(() => stream.result());
    return { events: [...events], messages };
  });

export const toolResultIds = (events: readonly AgentEvent[]): string[] =>
  events.flatMap((event) =>
    event.type === "message_end" && event.message.role === "toolResult"
      ? [event.message.toolCallId]
      : [],
  );

export const delayed =
  (millis: number) =>
  <A>(value: A): Promise<A> =>
    Effect.runPromise(Effect.as(Effect.sleep(millis), value));
