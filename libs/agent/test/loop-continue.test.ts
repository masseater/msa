import type { Message } from "@msa/ai";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { agentLoopContinue } from "../src/agent-loop.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage } from "../src/types.ts";
import {
  collect,
  createModel,
  createUserMessage,
  identityConverter,
  now,
  scripted,
  textMessage,
} from "./support/fixtures.ts";

const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter };

const throwsWithoutMessages = () => {
  expect(() =>
    agentLoopContinue({ messages: [], tools: [] }, config, undefined, () => {
      throw new Error("Unexpected stream call");
    }),
  ).toThrow("Cannot continue: no messages in context");
};

const continuesWithoutUserEvents = Effect.gen(function* () {
  const context: AgentContext = { messages: [createUserMessage("Hello")], tools: [] };
  const { streamFn } = scripted(textMessage("Response"));
  const { events, messages } = yield* collect(
    agentLoopContinue(context, config, undefined, streamFn),
  );
  expect(messages.length).toBe(1);
  expect(messages[0]?.role).toBe("assistant");
  const messageEnds = events.filter((event) => event.type === "message_end");
  expect(messageEnds.length).toBe(1);
  expect(messageEnds[0]?.type === "message_end" ? messageEnds[0].message.role : "").toBe(
    "assistant",
  );
});

type CustomMessage = { role: "custom"; text: string; timestamp: number };

const customToUser = (messages: AgentMessage[]): Message[] =>
  messages
    .map((message) => {
      const custom = message as unknown as CustomMessage;
      return custom.role === "custom"
        ? { role: "user" as const, content: custom.text, timestamp: custom.timestamp }
        : message;
    })
    .filter(
      (message) =>
        message.role === "user" || message.role === "assistant" || message.role === "toolResult",
    ) as Message[];

const continuesFromCustomMessage = Effect.gen(function* () {
  const customMessage: CustomMessage = { role: "custom", text: "Hook content", timestamp: now() };
  const context: AgentContext = {
    messages: [customMessage as unknown as AgentMessage],
    tools: [],
  };
  const { streamFn } = scripted(textMessage("Response to custom message"));
  const { messages } = yield* collect(
    agentLoopContinue(
      context,
      { model: createModel(), convertToLlm: customToUser },
      undefined,
      streamFn,
    ),
  );
  expect(messages.length).toBe(1);
  expect(messages[0]?.role).toBe("assistant");
});

describe("agentLoopContinue with AgentMessage", () => {
  it("should throw when context has no messages", throwsWithoutMessages);
  it("should continue from existing context without emitting user message events", () =>
    Effect.runPromise(continuesWithoutUserEvents));
  it("should allow custom message types as last message (caller responsibility)", () =>
    Effect.runPromise(continuesFromCustomMessage));
});
