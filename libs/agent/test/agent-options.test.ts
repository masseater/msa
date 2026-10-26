import ai from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentModule from "../src/index.ts";
import type agentTypes from "../src/index.types.ts";
import fixtures from "./support/fixtures.ts";

const { createAssistantMessageEventStream } = ai;

const { Agent } = agentModule;

const { createUserMessage, respond, scripted, stoppedWith, textMessage, toolCallMessage } =
  fixtures;

const noop = (text: string): agentTypes.AgentTool => ({
  description: "Noop tool",
  execute: () => Promise.resolve({ content: [{ text, type: "text" }], details: {} }),
  label: "Noop",
  name: "noop",
  parameters: Type.Object({}),
});

const legacyPrepareNextTurn = Effect.gen(function* () {
  let sawAbortSignal = false;
  const script = scripted(toolCallMessage([{ id: "tool-1", name: "noop" }]), textMessage("done"));
  const agent = new Agent({
    initialState: { tools: [noop("ok")] },
    prepareNextTurn: (signal) => {
      sawAbortSignal = signal instanceof AbortSignal;
      return Promise.resolve(undefined);
    },
    streamFn: script.streamFn,
  });
  yield* Effect.promise(() => agent.prompt("start"));
  expect(script.calls()).toBe(2);
  expect(sawAbortSignal).toBe(true);
});

const forwardsFinishTurn = Effect.gen(function* () {
  let sawAbortSignal = false;
  let roles: string[] = [];
  const script = scripted(
    toolCallMessage([{ id: "tool-1", name: "noop" }]),
    textMessage("should not run"),
  );
  const agent = new Agent({
    finishTurn: (turn, signal) => {
      sawAbortSignal = signal instanceof AbortSignal;
      roles = turn.context.messages.map((message) => message.role);
      return { action: "end" };
    },
    initialState: { tools: [noop("tool complete")] },
    streamFn: script.streamFn,
  });
  yield* Effect.promise(() => agent.prompt("start"));
  expect(script.calls()).toBe(1);
  expect(sawAbortSignal).toBe(true);
  expect(roles).toEqual(["system", "user", "assistant", "toolResult"]);
});

const keepsQueues = (options: Pick<agentTypes.AgentOptions, "finishTurn" | "streamFn">) =>
  Effect.gen(function* () {
    const queuedDuringResponse = createUserMessage("steering");
    const followUp = createUserMessage("follow-up");
    const agent = new Agent(options);
    agent.followUp(followUp);
    agent.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        agent.steer(queuedDuringResponse);
      }
    });
    yield* Effect.promise(() => agent.prompt("start"));
    expect(agent.peekQueuedMessages()).toEqual([queuedDuringResponse]);
    agent.clearSteeringQueue();
    expect(agent.peekQueuedMessages()).toEqual([followUp]);
  });

const failingResponse =
  (stopReason: "error" | "aborted"): agentTypes.StreamFn =>
  () =>
    respond({ ...stoppedWith(stopReason)(textMessage(stopReason)), errorMessage: stopReason });

const providerEventStream: agentTypes.StreamFn = (model, _context, options) => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    Effect.runFork(
      Effect.andThen(
        Effect.promise(() =>
          Promise.resolve(options?.onProviderStreamEvent?.({ request_cost: 0.01 }, model)),
        ),
        Effect.sync(() => {
          stream.push({ message: textMessage("ok"), reason: "stop", type: "done" });
        }),
      ),
    );
  });
  return stream;
};

const forwardsProviderEvents = Effect.gen(function* () {
  const providerEvents: unknown[] = [];
  const agent = new Agent({
    onProviderStreamEvent: (data) => {
      providerEvents.push(data);
    },
    streamFn: providerEventStream,
  });
  yield* Effect.promise(() => agent.prompt("hello"));
  expect(providerEvents).toEqual([{ request_cost: 0.01 }]);
});

const forwardsSessionId = Effect.gen(function* () {
  let receivedSessionId: string | undefined;
  const agent = new Agent({
    sessionId: "session-abc",
    streamFn: (_model, _context, options) => {
      receivedSessionId = options?.sessionId;
      return respond(textMessage("ok"));
    },
  });
  yield* Effect.promise(() => agent.prompt("hello"));
  expect(receivedSessionId).toBe("session-abc");
  agent.sessionId = "session-def";
  expect(agent.sessionId).toBe("session-def");
  yield* Effect.promise(() => agent.prompt("hello again"));
  expect(receivedSessionId).toBe("session-def");
});

const finalizesBeforeListeners = Effect.gen(function* () {
  const replacements: agentTypes.AgentMessage[] = [];
  const delivered: { readonly first: unknown[]; readonly second: unknown[] } = {
    first: [],
    second: [],
  };
  const script = scripted(toolCallMessage([{ id: "tool-1", name: "noop" }]), textMessage("done"));
  const agent = new Agent({
    finalizeMessage: (message) => {
      if (message.role !== "user") return undefined;
      const replacement = { ...message, content: "replaced" };
      replacements.push(replacement);
      return replacement;
    },
    initialState: { tools: [noop("ok")] },
    streamFn: script.streamFn,
  });
  agent.subscribe((event) => {
    if (event.type === "message_end") delivered.first.push(event.message);
  });
  agent.subscribe((event) => {
    if (event.type === "message_end") delivered.second.push(event.message);
  });
  yield* Effect.promise(() => agent.prompt("start"));
  const [replacement] = replacements;
  expect(replacements).toHaveLength(1);
  expect(delivered.first).toContain(replacement);
  expect(delivered.second).toContain(replacement);
  expect(delivered.first).toEqual(delivered.second);
  expect(agent.state.messages).toContain(replacement);
  const secondUsers = (script.contexts[1]?.messages ?? []).flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    return message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
  });
  expect(secondUsers).toEqual(["replaced"]);
});

describe("Agent options", () => {
  it("delivers the message finalizeMessage returns to every message_end listener, the state and the next turn", () =>
    Effect.runPromise(finalizesBeforeListeners));
  it("keeps legacy prepareNextTurn signal callback behavior", () =>
    Effect.runPromise(legacyPrepareNextTurn));
  it("forwards finishTurn through AgentOptions with the active abort signal", () =>
    Effect.runPromise(forwardsFinishTurn));
  it.each(["error", "aborted"] as const)(
    "keeps queues on a %s response even when finishTurn requests continuation",
    (stopReason) =>
      Effect.runPromise(
        keepsQueues({
          finishTurn: () => ({ action: "continue" }),
          streamFn: failingResponse(stopReason),
        }),
      ),
  );
  it("keeps queues when finishTurn ends the run", () =>
    Effect.runPromise(
      keepsQueues({
        finishTurn: () => ({ action: "end" }),
        streamFn: scripted(textMessage("done")).streamFn,
      }),
    ));
  it("forwards provider stream event observers through AgentOptions", () =>
    Effect.runPromise(forwardsProviderEvents));
  it("forwards sessionId to streamFunction options", () => Effect.runPromise(forwardsSessionId));
});
