import compat from "@msa/ai/compat";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentModule2 from "../src/index.ts";
import type agentTypes from "../src/index.types.ts";
import agentModule from "./support/agent.ts";
import fixtures from "./support/fixtures.ts";

const { getModels } = compat;

const { Agent, setDefaultStreamFn } = agentModule2;

const { unusedStreamFunction } = agentModule;
const { createUserMessage, now, scripted, textMessage } = fixtures;

const echoTool: agentTypes.AgentTool = {
  description: "Echo input",
  execute: () => Promise.resolve({ content: [{ text: "echo", type: "text" }], details: {} }),
  label: "Echo",
  name: "echo",
  parameters: Type.Object({}),
};

const usesConfiguredDefault = Effect.gen(function* () {
  const script = scripted(textMessage("fallback"));
  setDefaultStreamFn(script.streamFn);
  const agent = Reflect.construct(Agent, [{}]) as agentTypes.Agent;
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
  const customModel = getModels("openai").find((model) => model.reasoning);
  if (customModel === undefined) throw new Error("the openai catalog has no reasoning model");
  const agent = new Agent({
    initialState: {
      model: customModel,
      systemPrompt: "You are a helpful assistant.",
      thinkingLevel: "low",
    },
    streamFn: unusedStreamFunction(),
  });
  expect(agent.state.messages).toEqual([
    { content: "You are a helpful assistant.", role: "system", timestamp: 0 },
  ]);
  expect(agent.state.model).toBe(customModel);
  expect(agent.state.thinkingLevel).toBe("low");
};

const expectBaseline = (message: agentTypes.AgentMessage | undefined) => {
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
      messages: [{ content: "old", role: "user", timestamp: 1 }],
      systemPrompt: "You are helpful.",
      tools: [echoTool],
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
  const newModel = getModels("opencode").find((model) => model.id !== agent.state.model.id);
  if (newModel === undefined) throw new Error("the opencode catalog has no other model");
  agent.state.model = newModel;
  expect(agent.state.model).toBe(newModel);
  agent.state.thinkingLevel = "high";
  expect(agent.state.thinkingLevel).toBe("high");
  const tools = [{ description: "test tool", name: "test" } as agentTypes.AgentTool];
  agent.state.tools = tools;
  expect(agent.state.tools).toEqual(tools);
  expect(agent.state.tools).not.toBe(tools);
  const messages = [{ content: "Hello", role: "user" as const, timestamp: now() }];
  agent.state.messages = messages;
  expect(agent.state.messages).toEqual(messages);
  expect(agent.state.messages).not.toBe(messages);
  const newMessage = { content: [{ text: "Hi", type: "text" }], role: "assistant" };
  agent.state.messages.push(newMessage as agentTypes.AgentMessage);
  expect(agent.state.messages).toHaveLength(2);
  expect(agent.state.messages[1]).toBe(newMessage);
  agent.state.messages = [];
  expect(agent.state.messages).toEqual([]);
};

const queuesSteering = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  const message = { content: "Steering message", role: "user" as const, timestamp: now() };
  agent.steer(message);
  expect(agent.state.messages).not.toContainEqual(message);
};

const queuesFollowUp = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  const message = { content: "Follow-up message", role: "user" as const, timestamp: now() };
  agent.followUp(message);
  expect(agent.state.messages).not.toContainEqual(message);
};

const abortsIdle = () => {
  const agent = new Agent({ streamFn: unusedStreamFunction() });
  expect(() => agent.abort()).not.toThrow();
};

const previewsQueues = () => {
  const agent = new Agent({
    followUpMode: "all",
    steeringMode: "one-at-a-time",
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
