import { rm } from "node:fs/promises";

import { Type, type Usage } from "@msa/ai";
import {
  type AgentEvent,
  defineTool,
  LiveDoc,
  MemoryStorage,
  type NestedToolExecutionResult,
  UsageDoc,
  watchEvents,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import {
  directories,
  results,
  toolTasks,
  runOnce,
  text,
  DONE,
  call,
  tool,
} from "./harness-nested-tools-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

function batchLeavingCallRunning() {
  const setup = chatSetup();
  const running = deferred();
  addTool(
    setup.registry,
    tool("hang", async (_args, api, callContext) => {
      api.output("partial\n");
      await api.details({ step: 1 }, callContext);
      running.resolve();
      return aborted(callContext.abortSignal!);
    }),
  );
  const left: { abandoned?: Promise<NestedToolExecutionResult> } = {};
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      left.abandoned = api.executeTool("hang", {}, callContext);
      left.abandoned.catch(() => {});
      await running.promise;
      return { output: [{ type: "text", text: "returned early" }] };
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup };
}

function slowNestedBatch() {
  const setup = chatSetup();
  const release = deferred();
  const running = deferred();
  addTool(
    setup.registry,
    tool("slow", async (_args, api, callContext) => {
      api.output("working\n");
      await api.details({ step: 1 }, callContext);
      running.resolve();
      await release.promise;
      return { output: [{ type: "text", text: "slow done" }] };
    }),
  );
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      const result = await api.executeTool("slow", {}, callContext);
      return { output: [{ type: "text", text: text(result) }] };
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup, release, running };
}

async function openSlowNestedBatch() {
  const { setup, release, running } = slowNestedBatch();
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const stream = await watchEvents(harness, root.id, context);
  expect(stream.snapshot.nestedTools).toEqual([]);
  const events: AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { release, running, harness, root, stream, events };
}

async function slowNestedCallRunning() {
  const { release, running, harness, root, stream, events } = await openSlowNestedBatch();
  const submission = await root.submit({ type: "input", content: "go" }, context);
  await running.promise;
  const live = await harness.snapshot(LiveDoc, root.id, context);
  expect(live?.nestedTools).toEqual([
    {
      callId: "c1/1",
      parentCallId: "c1",
      parentTaskId: expect.any(Number),
      name: "slow",
      taskId: expect.any(Number),
      arguments: {},
      status: "running",
      output: "working\n",
      details: { step: 1 },
    },
  ]);
  return { release, harness, root, stream, events, submission };
}

describe("nested tool calls", () => {
  it("matches a reused key's arguments regardless of key order", async () => {
    const setup = chatSetup();
    let runs = 0;
    addTool(
      setup.registry,
      defineTool({
        name: "pair",
        description: "pair",
        parameters: Type.Object({ a: Type.String(), b: Type.String() }),
        execute: (args) => {
          runs++;
          return Promise.resolve({ output: [{ type: "text", text: `${args.a}${args.b}` }] });
        },
      }),
    );
    const nested: NestedToolExecutionResult[] = [];
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        nested.push(await api.executeTool("pair", { a: "x", b: "y" }, callContext, { key: "k" }));
        nested.push(await api.executeTool("pair", { b: "y", a: "x" }, callContext, { key: "k" }));
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    expect(runs).toBe(1);
    expect(nested.map((result) => text(result))).toEqual(["xy", "xy"]);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("aborts the nested calls a caller left running when it returns, keeping their details", async () => {
    const { setup } = batchLeavingCallRunning();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const stream = await watchEvents(harness, root.id, context);
    const ends: AgentEvent[] = [];
    stream.start((batch) => {
      ends.push(...batch.filter((event) => event.type === "tool_execution_end"));

      return Promise.resolve();
    });
    const settled = await (
      await root.submit({ type: "input", content: "go" }, context)
    ).wait(context);
    expect(settled.status).toBe("done");
    await harness.waitForIdle(context);
    await stream.stop();
    const [result] = results(await allEntries(root));
    expect(text(result)).toBe("returned early");
    const [, child] = await toolTasks(harness);
    expect(child!.state).toMatchObject({
      status: "terminal",
      outcome: { status: "aborted", result: { kind: "nested" } },
    });
    // The aborted call's result keeps its details; programs get no partial output, which only the model read.
    const childEnd = ends.find(
      (event) => event.type === "tool_execution_end" && event.toolCallId === "c1/1",
    );
    expect(childEnd).toMatchObject({ result: { isError: true, details: { step: 1 } } });
    expect((childEnd as { result?: NestedToolExecutionResult }).result).not.toHaveProperty(
      "structuredOutput",
    );
    // The nested call ends, with its result, before its caller.
    expect(
      ends.map((event) => [
        event.type === "tool_execution_end" && event.toolCallId,
        "result" in event,
      ]),
    ).toEqual([
      ["c1/1", true],
      ["c1", false],
    ]);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("records a nested call's usage under its tool", async () => {
    const setup = chatSetup();
    const usage: Usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    };
    addTool(
      setup.registry,
      tool("paid", () => Promise.resolve({ usage })),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await api.executeTool("paid", {}, callContext);
        return {};
      }),
    );
    const { harness, root } = await runOnce(setup, [call("batch"), DONE]);
    expect((await harness.snapshot(UsageDoc, root.id, context))?.tools).toEqual({ paid: usage });
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("reports nested calls in msa.live.nestedTools and as tool events with their parent", async () => {
    const { release, harness, root, stream, events, submission } = await slowNestedCallRunning();
    release.resolve();
    await submission.wait(context);
    await harness.waitForIdle(context);
    await stream.stop();
    const tools = events.flatMap((event) =>
      event.type === "tool_execution_start" || event.type === "tool_execution_end"
        ? [[event.type, event.toolCallId, event.parentToolCallId]]
        : [],
    );
    expect(tools).toEqual([
      ["tool_execution_start", "c1", undefined],
      ["tool_execution_start", "c1/1", "c1"],
      ["tool_execution_end", "c1/1", "c1"],
      ["tool_execution_end", "c1", undefined],
    ]);
    const nestedEnd = events.find(
      (event) => event.type === "tool_execution_end" && event.toolCallId === "c1/1",
    );
    expect(nestedEnd).toMatchObject({ result: { structuredOutput: "slow done", isError: false } });
    // Events name the call's task and, for a nested call, the calling one.
    const [parent, child] = await toolTasks(harness);
    const parentEnd = events.find(
      (event) => event.type === "tool_execution_end" && event.toolCallId === "c1",
    );
    expect(nestedEnd).toMatchObject({ taskId: child!.id, parentTaskId: parent!.id });
    expect(parentEnd).toMatchObject({ taskId: parent!.id });
    expect(parentEnd).not.toHaveProperty("parentTaskId");
    expect(
      events.some(
        (event) =>
          event.type === "tool_execution_update" &&
          event.toolCallId === "c1/1" &&
          event.parentToolCallId === "c1",
      ),
    ).toBe(true);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});
