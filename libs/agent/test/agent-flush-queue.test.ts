import compat from "@msa/ai/compat";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentModule from "../src/index.ts";
import type agentTypes from "../src/index.types.ts";
import fixtures from "./support/fixtures.ts";

const { createAssistantMessageEventStream } = compat;

const { Agent } = agentModule;

const { createUserMessage, respond, textMessage, toolCallMessage } = fixtures;

interface QueuedRun {
  readonly agent: agentTypes.Agent;
  readonly flushed: readonly (number | undefined)[];
  readonly requests: readonly string[][];
}

const userTexts = (messages: readonly { role: string; content: unknown }[]): string[] =>
  messages.flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((part: { type: string; text?: string }) =>
      part.type === "text" && part.text !== undefined ? [part.text] : [],
    );
  });

const runWithQueuedDuringTool = (
  queue: (agent: agentTypes.Agent) => number | undefined,
): QueuedRun => {
  const requests: string[][] = [];
  const flushed: (number | undefined)[] = [];
  const schema = Type.Object({});
  const holder: { agent?: agentTypes.Agent } = {};
  const tool: agentTypes.AgentTool<typeof schema> = {
    description: "Noop tool",
    execute: () => {
      if (holder.agent !== undefined) flushed.push(queue(holder.agent));
      return Promise.resolve({ content: [{ text: "ok", type: "text" }], details: {} });
    },
    label: "Noop",
    name: "noop",
    parameters: schema,
  };
  const agent = new Agent({
    initialState: { tools: [tool] },
    streamFn: (_model, context) => {
      requests.push(userTexts(context.messages));
      return respond(
        requests.length === 1
          ? toolCallMessage([{ id: "tool-1", name: "noop" }])
          : textMessage("done"),
      );
    },
  });
  holder.agent = agent;
  return { agent, flushed, requests };
};

const promptStart = (
  queue: (agent: agentTypes.Agent) => number | undefined,
): Effect.Effect<QueuedRun> =>
  Effect.suspend(() => {
    const run = runWithQueuedDuringTool(queue);
    return Effect.as(
      Effect.promise(() => run.agent.prompt("start")),
      run,
    );
  });

const deliversAllInOrder = Effect.map(
  promptStart((agent) => {
    agent.steer(createUserMessage("steer 1"));
    agent.followUp(createUserMessage("follow-up 1"));
    agent.steer(createUserMessage("steer 2"));
    return agent.flushQueuedMessages();
  }),
  ({ agent, flushed, requests }) => {
    expect(flushed).toEqual([3]);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(["start", "steer 1", "follow-up 1", "steer 2"]);
    expect(agent.hasQueuedMessages()).toBe(false);
  },
);

const deliversOnePerBoundary = Effect.map(
  promptStart((agent) => {
    agent.steer(createUserMessage("steer 1"));
    agent.steer(createUserMessage("steer 2"));
    return undefined;
  }),
  ({ requests }) => {
    expect(requests[1]).toEqual(["start", "steer 1"]);
    expect(requests[2]).toEqual(["start", "steer 1", "steer 2"]);
  },
);

const keepsLateMessagesQueued = Effect.map(
  promptStart((agent) => {
    agent.steer(createUserMessage("steer 1"));
    const count = agent.flushQueuedMessages();
    agent.steer(createUserMessage("late steer"));
    return count;
  }),
  ({ requests }) => {
    expect(requests[1]).toEqual(["start", "steer 1"]);
    expect(requests[2]).toEqual(["start", "steer 1", "late steer"]);
  },
);

describe("Agent.flushQueuedMessages", () => {
  it("delivers every queued message at the next boundary in queue order", () =>
    Effect.runPromise(deliversAllInOrder));

  it("delivers queued messages one per boundary when they are not flushed", () =>
    Effect.runPromise(deliversOnePerBoundary));

  it("releases nothing and keeps the queues empty when nothing is queued", () => {
    const agent = new Agent({ streamFn: () => createAssistantMessageEventStream() });

    expect(agent.flushQueuedMessages()).toBe(0);
    expect(agent.hasQueuedMessages()).toBe(false);
  });

  it("keeps messages queued after the flush on the normal one-at-a-time schedule", () =>
    Effect.runPromise(keepsLateMessagesQueued));
});
