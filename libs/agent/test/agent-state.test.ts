import { getModel } from "@msa/ai/compat";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { Agent, type AgentMessage, type AgentTool, setDefaultStreamFn } from "../src/index.ts";
import { unusedStreamFunction } from "./support/agent.ts";
import { createUserMessage, now, scripted, textMessage } from "./support/fixtures.ts";

const echoTool: AgentTool = {
  name: "echo",
  label: "Echo",
  description: "Echo input",
  parameters: Type.Object({}),
  execute: () => Promise.resolve({ content: [{ type: "text", text: "echo" }], details: {} }),
};

const usesConfiguredDefault = Effect.gen(function* () {
  const script = scripted(textMessage("fallback"));
  setDefaultStreamFn(script.streamFn);
  const agent = Reflect.construct(Agent, [{}]) as Agent;
  yield* Effect.promise(() => agent.prompt("Hello"));
  expect(script.calls()).toBe(1);
}).pipe(Effect.ensuring(Effect.sync(() => setDefaultStreamFn(undefined))));

const defaultState = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  expect(agent.state).toBeDefined();
  expect(agent.state.model).toBeDefined();
  expect(agent.state.thinkingLevel).toBe("off");
  expect(agent.state.tools).toEqual([]);
  expect(agent.state.messages).toEqual([]);
  expect(agent.state.isStreaming).toBe(false);
  expect(agent.state.streamingMessage).toBe(undefined);
  expect(agent.state.pendingToolCalls).toEqual(new Set());
  expect(agent.state.errorMessage).toBeUndefined();
};

const customInitialState = () => {
  const customModel = getModel("openai", "gpt-4o-mini");
  const agent = new Agent({
    streamFn: unusedStreamFunction(),
    initialState: {
      systemPrompt: "You are a helpful assistant.",
      model: customModel,
      thinkingLevel: "low",
    },
  });
  expect(agent.state.messages).toEqual([
    { role: "system", content: "You are a helpful assistant.", timestamp: 0 },
  ]);
  expect(agent.state.model).toBe(customModel);
  expect(agent.state.thinkingLevel).toBe("low");
};

const expectBaseline = (message: AgentMessage | undefined) => {
  expect(message?.role).toBe("system");
  if (message?.role !== "system") throw new Error("expected initial system message");
  expect(message.content).toBe("You are helpful.");
  expect(message.toolsAdded?.map((value) => value.name)).toEqual(["echo"]);
};

const initialTranscript = () => {
  const agent = new Agent({
    initialState: { systemPrompt: "You are helpful.", tools: [echoTool] },
    streamFn: unusedStreamFunction(),
  });
  expectBaseline(agent.state.messages[0]);
};

const resetsToBaseline = () => {
  const agent = new Agent({
    initialState: {
      systemPrompt: "You are helpful.",
      tools: [echoTool],
      messages: [{ role: "user", content: "old", timestamp: 1 }],
    },
    streamFn: unusedStreamFunction(),
  });
  agent.reset();
  expect(agent.state.messages).toHaveLength(1);
  expectBaseline(agent.state.messages[0]);
};

const subscribes = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  let eventCount = 0;
  const unsubscribe = agent.subscribe(() => {
    eventCount++;
  });
  expect(eventCount).toBe(0);
  agent.state.thinkingLevel = "low";
  expect(eventCount).toBe(0);
  expect(agent.state.thinkingLevel).toBe("low");
  unsubscribe();
  agent.state.thinkingLevel = "high";
  expect(eventCount).toBe(0);
};

const mutatesState = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  const newModel = getModel("opencode", "gemini-3-flash");
  agent.state.model = newModel;
  expect(agent.state.model).toBe(newModel);
  agent.state.thinkingLevel = "high";
  expect(agent.state.thinkingLevel).toBe("high");
  const tools = [{ name: "test", description: "test tool" } as AgentTool];
  agent.state.tools = tools;
  expect(agent.state.tools).toEqual(tools);
  expect(agent.state.tools).not.toBe(tools);
  const messages = [{ role: "user" as const, content: "Hello", timestamp: now() }];
  agent.state.messages = messages;
  expect(agent.state.messages).toEqual(messages);
  expect(agent.state.messages).not.toBe(messages);
  const newMessage = { role: "assistant", content: [{ type: "text", text: "Hi" }] };
  agent.state.messages.push(newMessage as AgentMessage);
  expect(agent.state.messages).toHaveLength(2);
  expect(agent.state.messages[1]).toBe(newMessage);
  agent.state.messages = [];
  expect(agent.state.messages).toEqual([]);
};

const queuesSteering = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  const message = { role: "user" as const, content: "Steering message", timestamp: now() };
  agent.steer(message);
  expect(agent.state.messages).not.toContainEqual(message);
};

const queuesFollowUp = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  const message = { role: "user" as const, content: "Follow-up message", timestamp: now() };
  agent.followUp(message);
  expect(agent.state.messages).not.toContainEqual(message);
};

const abortsIdle = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  expect(() => agent.abort()).not.toThrow();
};

const previewsQueues = () => {
  const agent = new Agent({
    steeringMode: "one-at-a-time",
    followUpMode: "all",
    streamFn: unusedStreamFunction(),
  });
  const first = createUserMessage("first steering");
  const followUp = createUserMessage("follow-up");
  agent.steer(first);
  agent.steer(createUserMessage("second steering"));
  agent.followUp(followUp);
  expect(agent.peekQueuedMessages()).toEqual([first]);
  expect(agent.peekQueuedMessages()).toEqual([first]);
  agent.clearSteeringQueue();
  expect(agent.peekQueuedMessages()).toEqual([followUp]);
};

describe("Agent state", () => {
  it("uses the configured default when a legacy caller omits streamFn", () =>
    Effect.runPromise(usesConfiguredDefault));
  it("should create an agent instance with default state", defaultState);
  it("should create an agent instance with custom initial state", customInitialState);
  it("converts initial prompt and tools into transcript state", initialTranscript);
  it("restores the transcript baseline when reset", resetsToBaseline);
  it("should subscribe to events", subscribes);
  it("should update state with mutators", mutatesState);
  it("should support steering message queue", queuesSteering);
  it("should support follow-up message queue", queuesFollowUp);
  it("should handle abort controller", abortsIdle);
  it("previews the next selected queued messages without consuming them", previewsQueues);
});
