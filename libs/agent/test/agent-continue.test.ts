import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import agentModule2 from "../src/index.ts";
import type agentTypes from "../src/index.types.ts";
import agentModule from "./support/agent.ts";
import fixtures from "./support/fixtures.ts";

const { Agent } = agentModule2;

const { unusedStreamFunction, userTexts } = agentModule;
const { createUserMessage, now, respond, textMessage, toolCallMessage } = fixtures;

const recordingAgent = (options: {
  messages?: agentTypes.AgentMessage[];
  steeringMode?: agentTypes.QueueMode;
}) => {
  const requests: string[][] = [];
  const agent = new Agent({
    initialState: { messages: options.messages ?? [] },
    ...(options.steeringMode === undefined ? {} : { steeringMode: options.steeringMode }),
    streamFn: (_model, context) => {
      requests.push(userTexts(context));
      return respond(textMessage("done"));
    },
  });
  return { agent, requests };
};

const hasText = (message: agentTypes.AgentMessage, text: string): boolean => {
  if (message.role !== "user") return false;
  if (typeof message.content === "string") return message.content === text;
  return message.content.some((part) => part.type === "text" && part.text === text);
};

const processesFollowUp = Effect.gen(function* () {
  const { agent } = recordingAgent({});
  agent.state.messages = [
    { content: [{ text: "Initial", type: "text" }], role: "user", timestamp: now() - 10 },
    textMessage("Initial response"),
  ];
  agent.followUp({
    content: [{ text: "Queued follow-up", type: "text" }],
    role: "user",
    timestamp: now(),
  });
  yield* Effect.promise(() => expect(agent.continue()).resolves.toBeUndefined());
  expect(agent.state.messages.some((message) => hasText(message, "Queued follow-up"))).toBe(true);
  expect(agent.state.messages.at(-1)?.role).toBe("assistant");
});

const expectSteering = (
  requests: string[][],
  mode: agentTypes.QueueMode,
  [first, second]: [string, string],
) => {
  expect(requests[0]).toContain(first);
  if (mode === "one-at-a-time") {
    expect(requests[0]).not.toContain(second);
    expect(requests[1]).toContain(second);
  } else {
    expect(requests[0]).toContain(second);
  }
};

const assistantTailSteering = (mode: agentTypes.QueueMode, expectedRequests: number) =>
  Effect.gen(function* () {
    const { agent, requests } = recordingAgent({
      messages: [createUserMessage("Initial"), textMessage("Initial response")],
      steeringMode: mode,
    });
    agent.steer(createUserMessage("Steering 1"));
    agent.steer(createUserMessage("Steering 2"));
    yield* Effect.promise(() => expect(agent.continue()).resolves.toBeUndefined());
    expect(requests).toHaveLength(expectedRequests);
    expectSteering(requests, mode, ["Steering 1", "Steering 2"]);
  });

const rejectsWithoutMessages = (messages: agentTypes.AgentMessage[]) =>
  Effect.gen(function* () {
    const agent = new Agent({ initialState: { messages }, streamFn: unusedStreamFunction() });
    const steering = createUserMessage("steering");
    const followUp = createUserMessage("follow-up");
    agent.steer(steering);
    agent.followUp(followUp);
    yield* Effect.promise(() =>
      expect(agent.continue()).rejects.toThrow("No messages to continue from"),
    );
    expect(agent.peekQueuedMessages()).toEqual([steering]);
    agent.clearSteeringQueue();
    expect(agent.peekQueuedMessages()).toEqual([followUp]);
  });

const toolResultTail: agentTypes.AgentMessage[] = [
  createUserMessage("existing user"),
  toolCallMessage([{ id: "call-1", name: "noop" }]),
  {
    content: [{ text: "done", type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: 1,
    toolCallId: "call-1",
    toolName: "noop",
  },
];

const defersFollowUp = (messages: agentTypes.AgentMessage[]) =>
  Effect.gen(function* () {
    const { agent, requests } = recordingAgent({ messages });
    agent.followUp(createUserMessage("follow-up"));
    yield* Effect.promise(() => agent.continue());
    expect(requests).toHaveLength(2);
    expect(requests[0]).not.toContain("follow-up");
    expect(requests[1]).toContain("follow-up");
  });

const pollsSteeringAtStartup = (mode: agentTypes.QueueMode, expectedRequests: number) =>
  Effect.gen(function* () {
    const { agent, requests } = recordingAgent({
      messages: [createUserMessage("existing")],
      steeringMode: mode,
    });
    agent.steer(createUserMessage("first"));
    agent.steer(createUserMessage("second"));
    yield* Effect.promise(() => agent.continue());
    expect(requests).toHaveLength(expectedRequests);
    expectSteering(requests, mode, ["first", "second"]);
  });

const steeringBeforeFollowUp = Effect.gen(function* () {
  const { agent, requests } = recordingAgent({ messages: [createUserMessage("existing")] });
  agent.steer(createUserMessage("steering"));
  agent.followUp(createUserMessage("follow-up"));
  yield* Effect.promise(() => agent.continue());
  expect(requests).toHaveLength(2);
  expect(requests[0]).toContain("steering");
  expect(requests[0]).not.toContain("follow-up");
  expect(requests[1]).toContain("follow-up");
});

const modes = [
  { expectedRequests: 2, mode: "one-at-a-time" as const },
  { expectedRequests: 1, mode: "all" as const },
];

describe("Agent continue", () => {
  it("continue() should process queued follow-up messages after an assistant turn", () =>
    Effect.runPromise(processesFollowUp));
  it.each(modes)(
    "continue() keeps $mode steering semantics for assistant-tail fallback",
    ({ mode, expectedRequests }) =>
      Effect.runPromise(assistantTailSteering(mode, expectedRequests)),
  );
  it.each([
    { messages: [], name: "empty" },
    {
      messages: [{ content: "system only", role: "system" as const, timestamp: 1 }],
      name: "system-only",
    },
  ])("rejects a queued continuation from $name context without draining queues", ({ messages }) =>
    Effect.runPromise(rejectsWithoutMessages(messages)),
  );
  it.each([
    { messages: [createUserMessage("existing user")], name: "user" },
    { messages: toolResultTail, name: "toolResult" },
  ])("defers follow-up input on the first continuation request from a $name tail", ({ messages }) =>
    Effect.runPromise(defersFollowUp(messages)),
  );
  it.each(modes)("polls $mode steering at continuation startup", ({ mode, expectedRequests }) =>
    Effect.runPromise(pollsSteeringAtStartup(mode, expectedRequests)),
  );
  it("keeps steering ahead of follow-up from a non-assistant continuation tail", () =>
    Effect.runPromise(steeringBeforeFollowUp));
});
