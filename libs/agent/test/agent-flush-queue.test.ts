import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type UserMessage,
} from "@msa/ai/compat";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { Agent, type AgentTool } from "../src/index.ts";

function createUserMessage(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function createAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: "stop" | "toolUse",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "mock",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function userTexts(messages: readonly { role: string; content: unknown }[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((part: { type: string; text?: string }) =>
      part.type === "text" && part.text !== undefined ? [part.text] : [],
    );
  });
}

function runWithQueuedDuringTool(queue: (agent: Agent) => number | undefined) {
  const requests: string[][] = [];
  const flushed: Array<number | undefined> = [];
  const schema = Type.Object({});
  const holder: { agent?: Agent } = {};
  const tool: AgentTool<typeof schema> = {
    name: "noop",
    label: "Noop",
    description: "Noop tool",
    parameters: schema,
    execute: async () => {
      if (holder.agent) flushed.push(queue(holder.agent));
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  };
  const agent = new Agent({
    initialState: { tools: [tool] },
    streamFn: (_model, context) => {
      requests.push(userTexts(context.messages));
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        if (requests.length === 1) {
          stream.push({
            type: "done",
            reason: "toolUse",
            message: createAssistantMessage(
              [{ type: "toolCall", id: "tool-1", name: "noop", arguments: {} }],
              "toolUse",
            ),
          });
          return;
        }
        stream.push({
          type: "done",
          reason: "stop",
          message: createAssistantMessage([{ type: "text", text: "done" }], "stop"),
        });
      });
      return stream;
    },
  });
  holder.agent = agent;
  return { agent, requests, flushed };
}

describe("Agent.flushQueuedMessages", () => {
  it("delivers every queued message at the next boundary in queue order", async () => {
    const { agent, requests, flushed } = runWithQueuedDuringTool((a) => {
      a.steer(createUserMessage("steer 1"));
      a.followUp(createUserMessage("follow-up 1"));
      a.steer(createUserMessage("steer 2"));
      return a.flushQueuedMessages();
    });

    await agent.prompt("start");

    expect(flushed).toEqual([3]);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(["start", "steer 1", "follow-up 1", "steer 2"]);
    expect(agent.hasQueuedMessages()).toBe(false);
  });

  it("delivers queued messages one per boundary when they are not flushed", async () => {
    const { agent, requests } = runWithQueuedDuringTool((a) => {
      a.steer(createUserMessage("steer 1"));
      a.steer(createUserMessage("steer 2"));
      return undefined;
    });

    await agent.prompt("start");

    expect(requests[1]).toEqual(["start", "steer 1"]);
    expect(requests[2]).toEqual(["start", "steer 1", "steer 2"]);
  });

  it("releases nothing and keeps the queues empty when nothing is queued", () => {
    const agent = new Agent({ streamFn: () => createAssistantMessageEventStream() });

    expect(agent.flushQueuedMessages()).toBe(0);
    expect(agent.hasQueuedMessages()).toBe(false);
  });

  it("keeps messages queued after the flush on the normal one-at-a-time schedule", async () => {
    const { agent, requests } = runWithQueuedDuringTool((a) => {
      a.steer(createUserMessage("steer 1"));
      const count = a.flushQueuedMessages();
      a.steer(createUserMessage("late steer"));
      return count;
    });

    await agent.prompt("start");

    expect(requests[1]).toEqual(["start", "steer 1"]);
    expect(requests[2]).toEqual(["start", "steer 1", "late steer"]);
  });
});
