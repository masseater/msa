import type { Message } from "@msa/ai";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { agentLoop } from "../src/agent-loop.ts";
import { setDefaultStreamFn } from "../src/index.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage } from "../src/types.ts";
import {
  collect,
  createAssistantMessage,
  createModel,
  createUserMessage,
  identityConverter,
  now,
  scripted,
  textMessage,
} from "./support/fixtures.ts";

const usesConfiguredDefault = Effect.gen(function* () {
  const script = scripted(textMessage("fallback"));
  setDefaultStreamFn(script.streamFn);
  const context: AgentContext = { messages: [], tools: [] };
  const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter };
  const stream = Reflect.apply(agentLoop, undefined, [
    [createUserMessage("Hello")],
    context,
    config,
    undefined,
  ]) as ReturnType<typeof agentLoop>;
  yield* Effect.promise(() => stream.result());
  expect(script.calls()).toBe(1);
}).pipe(Effect.ensuring(Effect.sync(() => setDefaultStreamFn(undefined))));

const emitsAgentMessageEvents = Effect.gen(function* () {
  const { streamFn } = scripted(textMessage("Hi there!"));
  const { events, messages } = yield* collect(
    agentLoop(
      [createUserMessage("Hello")],
      { messages: [], tools: [] },
      { model: createModel(), convertToLlm: identityConverter },
      undefined,
      streamFn,
    ),
  );
  expect(messages.length).toBe(2);
  expect(messages[0]?.role).toBe("user");
  expect(messages[1]?.role).toBe("assistant");
  const eventTypes = events.map((event) => event.type);
  for (const type of [
    "agent_start",
    "turn_start",
    "message_start",
    "message_end",
    "turn_end",
    "agent_end",
  ]) {
    expect(eventTypes).toContain(type);
  }
});

const transcriptOnlyContext = Effect.gen(function* () {
  const initialSystem: AgentMessage = {
    role: "system",
    content: "Transcript prompt",
    toolsAdded: [],
    timestamp: 1,
  };
  const script = scripted(textMessage("done"));
  const stream = agentLoop(
    [initialSystem, createUserMessage("Hello")],
    { messages: [], tools: [] },
    { model: createModel(), convertToLlm: identityConverter },
    undefined,
    script.streamFn,
  );
  yield* Effect.promise(() => stream.result());
  expect(Object.keys(script.contexts[0] ?? {})).toEqual(["messages"]);
  expect(script.contexts[0]?.messages[0]).toBe(initialSystem);
});

const customMessagesThroughConverter = Effect.gen(function* () {
  const notification = { role: "notification", text: "This is a notification", timestamp: now() };
  let convertedMessages: Message[] = [];
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: (messages) => {
      convertedMessages = messages
        .filter((message) => (message as { role: string }).role !== "notification")
        .filter(
          (message) =>
            message.role === "user" ||
            message.role === "assistant" ||
            message.role === "toolResult",
        ) as Message[];
      return convertedMessages;
    },
  };
  const context: AgentContext = {
    messages: [notification as unknown as AgentMessage],
    tools: [],
  };
  const { streamFn } = scripted(textMessage("Response"));
  yield* collect(agentLoop([createUserMessage("Hello")], context, config, undefined, streamFn));
  expect(convertedMessages.length).toBe(1);
  expect(convertedMessages[0]?.role).toBe("user");
});

const transformsBeforeConverting = Effect.gen(function* () {
  let transformedMessages: AgentMessage[] = [];
  let convertedMessages: Message[] = [];
  const config: AgentLoopConfig = {
    model: createModel(),
    transformContext: (messages) => {
      transformedMessages = messages.slice(-2);
      return Promise.resolve(transformedMessages);
    },
    convertToLlm: (messages) => {
      convertedMessages = messages.filter(
        (message) =>
          message.role === "user" || message.role === "assistant" || message.role === "toolResult",
      ) as Message[];
      return convertedMessages;
    },
  };
  const context: AgentContext = {
    messages: [
      createUserMessage("old message 1"),
      createAssistantMessage([{ type: "text", text: "old response 1" }]),
      createUserMessage("old message 2"),
      createAssistantMessage([{ type: "text", text: "old response 2" }]),
    ],
    tools: [],
  };
  const { streamFn } = scripted(textMessage("Response"));
  yield* collect(
    agentLoop([createUserMessage("new message")], context, config, undefined, streamFn),
  );
  expect(transformedMessages.length).toBe(2);
  expect(convertedMessages.length).toBe(2);
});

describe("default stream function compatibility", () => {
  it("uses the configured default when a legacy caller omits streamFn", () =>
    Effect.runPromise(usesConfiguredDefault));
});

describe("agentLoop with AgentMessage", () => {
  it("should emit events with AgentMessage types", () =>
    Effect.runPromise(emitsAgentMessageEvents));
  it("should build provider context exclusively from transcript messages", () =>
    Effect.runPromise(transcriptOnlyContext));
  it("should handle custom message types via convertToLlm", () =>
    Effect.runPromise(customMessagesThroughConverter));
  it("should apply transformContext before convertToLlm", () =>
    Effect.runPromise(transformsBeforeConverting));
});
