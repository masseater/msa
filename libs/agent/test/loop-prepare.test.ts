import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentLoopModule from "../src/agent-loop.ts";
import type typesModule from "../src/types.ts";
import fixtures from "./support/fixtures.ts";

const { agentLoop, runAgentLoop } = agentLoopModule;

const {
  collect,
  createModel,
  createUserMessage,
  echoResult,
  identityConverter,
  respond,
  scripted,
  textMessage,
  tool,
  toolCallMessage,
} = fixtures;

const echo = tool({ run: (_id, params) => Promise.resolve(echoResult(params.value)) });

const noop = tool({
  name: "noop",
  parameters: Type.Object({}),
  run: () => Promise.resolve({ content: [{ text: "done", type: "text" }], details: undefined }),
});

const replacementModel = { ...createModel(), id: "replacement", name: "replacement" };

const expectReplaced =
  (canonical: typesModule.AgentMessage): typesModule.StreamFn =>
  (model, context, options) => {
    expect(model).toBe(replacementModel);
    expect(context.messages).toEqual([canonical]);
    expect(options?.reasoning).toBe("high");
    return respond(textMessage("done"));
  };

const replacesInitialRequest = Effect.gen(function* () {
  const canonicalMessage = createUserMessage("canonical projection");
  const steeringMessage = createUserMessage("steering");
  const completedMessages: typesModule.AgentMessage[] = [];
  let steeringDelivered = false;
  let prepareCalls = 0;
  const config: typesModule.AgentLoopConfig = {
    convertToLlm: identityConverter,
    getSteeringMessages: () => {
      if (steeringDelivered) return Promise.resolve([]);
      steeringDelivered = true;
      return Promise.resolve([steeringMessage]);
    },
    model: createModel(),
    prepareRequest: ({ context }) => {
      prepareCalls++;
      expect(completedMessages).toContain(steeringMessage);
      expect(context.messages).toContain(steeringMessage);
      return {
        context: { ...context, messages: [canonicalMessage] },
        model: replacementModel,
        thinkingLevel: "high",
      };
    },
  };
  yield* Effect.promise(() =>
    runAgentLoop(
      [createUserMessage("prompt")],
      { messages: [], tools: [] },
      config,
      (event) => {
        if (event.type === "message_end") completedMessages.push(event.message);
      },
      undefined,
      expectReplaced(canonicalMessage),
    ),
  );
  expect(prepareCalls).toBe(1);
});

const noSteeringPollAfterPrepare = Effect.gen(function* () {
  const queued: typesModule.AgentMessage[] = [];
  const lateSteering = createUserMessage("late steering");
  let requestPreparations = 0;
  let steeringPolls = 0;
  const config: typesModule.AgentLoopConfig = {
    convertToLlm: identityConverter,
    getSteeringMessages: () => {
      steeringPolls++;
      return Promise.resolve(queued.splice(0));
    },
    model: createModel(),
    prepareRequest: () => {
      requestPreparations++;
      if (requestPreparations === 1) queued.push(lateSteering);
    },
  };
  const script = scripted(textMessage("done"));
  const stream = agentLoop(
    [createUserMessage("run")],
    { messages: [], tools: [] },
    config,
    undefined,
    script.streamFn,
  );
  yield* Effect.promise(() => stream.result());
  expect(script.contexts.map((context) => context.messages.includes(lateSteering))).toEqual([
    false,
    true,
  ]);
  expect(requestPreparations).toBe(2);
  expect(steeringPolls).toBe(3);
});

const usesNextTurnSnapshot = Effect.gen(function* () {
  let prepareCalls = 0;
  const config: typesModule.AgentLoopConfig = {
    convertToLlm: identityConverter,
    model: createModel(),
    prepareNextTurn: ({ context }) => {
      prepareCalls++;
      if (prepareCalls > 1) return Promise.resolve(undefined);
      return Promise.resolve({
        context: {
          messages: context.messages.slice(),
          ...(context.tools === undefined ? {} : { tools: context.tools }),
        },
        messages: [{ content: "updated guidance", role: "system", timestamp: 1 }],
      });
    },
  };
  const script = scripted(
    toolCallMessage([{ args: { value: "hello" }, id: "tool-1" }]),
    textMessage("done"),
  );
  yield* collect(
    agentLoop(
      [createUserMessage("echo something")],
      { messages: [], tools: [echo] },
      config,
      undefined,
      script.streamFn,
    ),
  );
  const second = script.contexts[1]?.messages ?? [];
  expect(script.calls()).toBe(2);
  expect(prepareCalls).toBe(1);
  expect(
    second.some((message) => message.role === "system" && message.content === "updated guidance"),
  ).toBe(true);
});

const steeringDuringNextTurn = Effect.gen(function* () {
  const queued: typesModule.AgentMessage[] = [];
  const lateSteering = createUserMessage("late steering");
  const config: typesModule.AgentLoopConfig = {
    convertToLlm: identityConverter,
    getSteeringMessages: () => Promise.resolve(queued.splice(0)),
    model: createModel(),
    prepareNextTurn: () => {
      queued.push(lateSteering);
      return undefined;
    },
  };
  const script = scripted(toolCallMessage([{ id: "tool-1", name: "noop" }]), textMessage("done"));
  const stream = agentLoop(
    [createUserMessage("run")],
    { messages: [], tools: [noop] },
    config,
    undefined,
    script.streamFn,
  );
  yield* Effect.promise(() => stream.result());
  expect(script.calls()).toBe(2);
  expect(script.contexts[1]?.messages.includes(lateSteering)).toBe(true);
});

const expectedEvents = [
  "agent_start",
  "turn_start",
  ...Array.from({ length: 3 }, () => ["message_start", "message_end"]).flat(),
  "tool_execution_start",
  "tool_execution_end",
  "message_start",
  "message_end",
  "turn_end",
  "agent_end",
];

const endWithFinalizedTurn = Effect.gen(function* () {
  const polls = { followUps: 0, steering: 0 };
  const seen: { ids: string[]; roles: string[] } = { ids: [], roles: [] };
  const config: typesModule.AgentLoopConfig = {
    convertToLlm: identityConverter,
    finishTurn: ({ message, toolResults, context }) => {
      expect(message.role).toBe("assistant");
      seen.ids = toolResults.map((toolResult) => toolResult.toolCallId);
      seen.roles = context.messages.map((contextMessage) => contextMessage.role);
      return Promise.resolve({ action: "end" as const });
    },
    getFollowUpMessages: () =>
      Promise.resolve((polls.followUps++, [createUserMessage("follow up should stay queued")])),
    getSteeringMessages: () => Promise.resolve((polls.steering++, [])),
    model: createModel(),
  };
  const script = scripted(
    toolCallMessage([{ args: { value: "hello" }, id: "tool-1" }]),
    textMessage("should not run"),
  );
  const { events, messages } = yield* collect(
    agentLoop(
      [createUserMessage("echo something")],
      { messages: [], tools: [echo] },
      config,
      undefined,
      script.streamFn,
    ),
  );
  expect(script.calls()).toBe(1);
  expect(polls).toEqual({ followUps: 0, steering: 1 });
  expect(seen).toEqual({ ids: ["tool-1"], roles: ["system", "user", "assistant", "toolResult"] });
  expect(messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
    "toolResult",
  ]);
  expect(events.map((event) => event.type)).toEqual(expectedEvents);
});

describe("agentLoop request preparation", () => {
  it("prepares the initial request after pending messages and can replace request state", () =>
    Effect.runPromise(replacesInitialRequest));
  it("does not poll steering after prepareRequest", () =>
    Effect.runPromise(noSteeringPollAfterPrepare));
  it("should use prepareNextTurn snapshot before continuing", () =>
    Effect.runPromise(usesNextTurnSnapshot));
  it("picks up steering queued during prepareNextTurn before the next request", () =>
    Effect.runPromise(steeringDuringNextTurn));
  it("action:end receives finalized turn context and stops before queue polling", () =>
    Effect.runPromise(endWithFinalizedTurn));
});
