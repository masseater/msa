import { createAssistantMessageEventStream } from "@msa/ai";
import { Deferred, Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { Agent } from "../src/index.ts";
import agentModule from "./support/agent.ts";
import fixtures from "./support/fixtures.ts";

const { abortableStream, awaitDeferred, release } = agentModule;
const { scripted, textMessage } = fixtures;

const failureEvents = [
  "agent_start",
  "turn_start",
  "message_start",
  "message_end",
  "message_start",
  "message_end",
  "turn_end",
  "agent_end",
];

const reportsThrownFailure = Effect.gen(function* () {
  const agent = new Agent({
    streamFn: () => {
      throw new Error("provider exploded");
    },
  });
  const events: string[] = [];
  agent.subscribe((event) => {
    events.push(event.type);
  });
  yield* Effect.promise(() => agent.prompt("hello"));
  expect(events).toEqual(failureEvents);
  const lastMessage = agent.state.messages.at(-1);
  if (lastMessage?.role !== "assistant") throw new Error("Expected assistant message");
  expect(lastMessage.stopReason).toBe("error");
  expect(lastMessage.errorMessage).toBe("provider exploded");
  expect(agent.state.errorMessage).toBe("provider exploded");
});

const awaitsSubscribers = Effect.gen(function* () {
  const barrier = yield* Deferred.make<void>();
  const agent = new Agent({ streamFn: scripted(textMessage("ok")).streamFn });
  let listenerFinished = false;
  agent.subscribe((event) =>
    event.type === "agent_end"
      ? awaitDeferred(barrier).then(() => {
          listenerFinished = true;
          return undefined;
        })
      : undefined,
  );
  let promptResolved = false;
  const prompt = agent.prompt("hello").then(() => {
    promptResolved = true;
    return undefined;
  });
  yield* Effect.sleep(10);
  expect(promptResolved).toBe(false);
  expect(listenerFinished).toBe(false);
  expect(agent.state.isStreaming).toBe(true);
  release(barrier);
  yield* Effect.promise(() => prompt);
  expect(listenerFinished).toBe(true);
  expect(promptResolved).toBe(true);
  expect(agent.state.isStreaming).toBe(false);
});

const idleWaitsForSubscribers = Effect.gen(function* () {
  const barrier = yield* Deferred.make<void>();
  const agent = new Agent({ streamFn: scripted(textMessage("ok")).streamFn });
  agent.subscribe((event) =>
    event.type === "message_end" && event.message.role === "assistant"
      ? awaitDeferred(barrier)
      : undefined,
  );
  const prompt = agent.prompt("hello");
  let idleResolved = false;
  const idle = agent.waitForIdle().then(() => {
    idleResolved = true;
    return undefined;
  });
  yield* Effect.sleep(10);
  expect(idleResolved).toBe(false);
  expect(agent.state.isStreaming).toBe(true);
  release(barrier);
  yield* Effect.promise(() => Promise.all([prompt, idle]));
  expect(idleResolved).toBe(true);
  expect(agent.state.isStreaming).toBe(false);
});

const passesAbortSignal = Effect.gen(function* () {
  let receivedSignal: AbortSignal | undefined;
  const agent = new Agent({ streamFn: abortableStream() });
  agent.subscribe((event, signal) => {
    if (event.type === "agent_start") receivedSignal = signal;
  });
  const prompt = agent.prompt("hello");
  yield* Effect.sleep(10);
  expect(receivedSignal).toBeDefined();
  expect(receivedSignal?.aborted).toBe(false);
  agent.abort();
  yield* Effect.promise(() => prompt);
  expect(receivedSignal?.aborted).toBe(true);
});

const heldStream = (started: Deferred.Deferred<void>, held: Deferred.Deferred<void>) => () => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ partial: textMessage(""), type: "start" });
    release(started);
    Effect.runFork(
      Effect.andThen(
        Deferred.await(held),
        Effect.sync(() => {
          stream.push({ message: textMessage("Done"), reason: "stop", type: "done" });
        }),
      ),
    );
  });
  return stream;
};

const rejectsResetWhileRunning = Effect.gen(function* () {
  const started = yield* Deferred.make<void>();
  const held = yield* Deferred.make<void>();
  const agent = new Agent({ streamFn: heldStream(started, held) });
  const prompt = agent.prompt("Hello");
  yield* Deferred.await(started);
  const roles = () => agent.state.messages.map((message) => message.role);
  yield* Effect.sync(() => {
    expect(agent.state.isStreaming).toBe(true);
    expect(roles()).toEqual(["user"]);
    expect(() => agent.reset()).toThrow(
      "Agent is already processing. Wait for completion before resetting.",
    );
    expect(agent.state.isStreaming).toBe(true);
    expect(roles()).toEqual(["user"]);
  }).pipe(
    Effect.ensuring(
      Effect.andThen(
        Deferred.done(held, Exit.void),
        Effect.promise(() => prompt),
      ),
    ),
  );
  expect(agent.state.isStreaming).toBe(false);
  expect(roles()).toEqual(["user", "assistant"]);
});

const rejectsWhileStreaming = (start: (agent: Agent) => Promise<void>, message: string) =>
  Effect.gen(function* () {
    const agent = new Agent({ streamFn: abortableStream() });
    const first = agent.prompt("First message");
    yield* Effect.sleep(10);
    expect(agent.state.isStreaming).toBe(true);
    yield* Effect.promise(() => expect(start(agent)).rejects.toThrow(message));
    agent.abort();
    yield* Effect.promise(() => first.catch(() => undefined));
  });

describe("Agent run lifecycle", () => {
  it("emits full lifecycle events for thrown run failures", () =>
    Effect.runPromise(reportsThrownFailure));
  it("should await async subscribers before prompt resolves", () =>
    Effect.runPromise(awaitsSubscribers));
  it("waitForIdle should wait for async subscribers", () =>
    Effect.runPromise(idleWaitsForSubscribers));
  it("should pass the active abort signal to subscribers", () =>
    Effect.runPromise(passesAbortSignal));
  it("should reject reset while processing without corrupting the transcript", () =>
    Effect.runPromise(rejectsResetWhileRunning));
  it("should throw when prompt() called while streaming", () =>
    Effect.runPromise(
      rejectsWhileStreaming(
        (agent) => agent.prompt("Second message"),
        "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
      ),
    ));
  it("should throw when continue() called while streaming", () =>
    Effect.runPromise(
      rejectsWhileStreaming(
        (agent) => agent.continue(),
        "Agent is already processing. Wait for completion before continuing.",
      ),
    ));
});
