import { Deferred, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import {
  Agent,
  type AgentEvent,
  type AgentTool,
  type AgentToolUpdateCallback,
} from "../src/index.ts";
import agentModule from "./support/agent.ts";
import fixtures from "./support/fixtures.ts";

const { awaitDeferred, release } = agentModule;
const { scripted, toolCallMessage } = fixtures;

const schema = Type.Object({});

type Status = { status: string };

const done = { content: [{ text: "done", type: "text" as const }], details: { status: "done" } };

const capturing = (
  name: string,
  capture: (update: AgentToolUpdateCallback<Status> | undefined) => void,
): AgentTool<typeof schema, Status> => ({
  description: "Captures progress callbacks",
  execute: (_id, _params, _signal, onUpdate) => {
    capture(onUpdate);
    return Promise.resolve({ ...done, terminate: true });
  },
  label: name,
  name,
  parameters: schema,
});

const late = { content: [{ text: "late", type: "text" as const }], details: { status: "late" } };

const ignoresLateUpdate = Effect.gen(function* () {
  let delayedUpdate: AgentToolUpdateCallback<Status> | undefined;
  const events: AgentEvent[] = [];
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (error: unknown) => {
    unhandledRejections.push(error);
  };
  const delayedTool = capturing("delayed_tool", (onUpdate) => {
    delayedUpdate = onUpdate;
    onUpdate?.({ content: [{ text: "running", type: "text" }], details: { status: "running" } });
  });
  const agent = new Agent({
    initialState: { tools: [delayedTool] },
    streamFn: scripted(toolCallMessage([{ id: "call-1", name: "delayed_tool" }])).streamFn,
  });
  agent.subscribe((event) => {
    events.push(event);
  });
  process.on("unhandledRejection", onUnhandledRejection);
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => agent.prompt("run tool"));
    const eventCountAfterPrompt = events.length;
    delayedUpdate?.(late);
    yield* Effect.sleep(0);
    expect(events.filter((event) => event.type === "tool_execution_update")).toHaveLength(1);
    expect(events).toHaveLength(eventCountAfterPrompt);
    expect(unhandledRejections).toEqual([]);
  }).pipe(
    Effect.ensuring(Effect.sync(() => process.off("unhandledRejection", onUnhandledRejection))),
  );
});

const slowTool = (started: Deferred.Deferred<void>, held: Deferred.Deferred<void>) => ({
  ...capturing("slow_tool", () => undefined),
  description: "Keeps the agent run active",
  execute: () => {
    release(started);
    return awaitDeferred(held).then(() => ({ ...done, terminate: true }));
  },
});

const ignoresSettledParallelUpdate = Effect.gen(function* () {
  const slowStarted = yield* Deferred.make<void>();
  const settledEnded = yield* Deferred.make<void>();
  const releaseSlow = yield* Deferred.make<void>();
  let settledUpdate: AgentToolUpdateCallback<Status> | undefined;
  const events: AgentEvent[] = [];
  const settledTool = capturing("settled_tool", (onUpdate) => {
    settledUpdate = onUpdate;
  });
  const agent = new Agent({
    initialState: { tools: [settledTool, slowTool(slowStarted, releaseSlow)] },
    streamFn: scripted(
      toolCallMessage([
        { id: "call-1", name: "settled_tool" },
        { id: "call-2", name: "slow_tool" },
      ]),
    ).streamFn,
  });
  agent.subscribe((event) => {
    events.push(event);
    if (event.type === "tool_execution_end" && event.toolCallId === "call-1") release(settledEnded);
  });
  const prompt = agent.prompt("run tools");
  yield* Effect.all([Deferred.await(slowStarted), Deferred.await(settledEnded)]);
  const eventCountBeforeLateUpdate = events.length;
  settledUpdate?.(late);
  yield* Effect.sleep(0);
  expect(events).toHaveLength(eventCountBeforeLateUpdate);
  release(releaseSlow);
  yield* Effect.promise(() => prompt);
  expect(events.filter((event) => event.type === "tool_execution_update")).toHaveLength(0);
});

describe("Agent tool updates", () => {
  it("should ignore tool updates after the tool execution settles", () =>
    Effect.runPromise(ignoresLateUpdate));
  it("should ignore a settled parallel tool update while another tool is still running", () =>
    Effect.runPromise(ignoresSettledParallelUpdate));
});
