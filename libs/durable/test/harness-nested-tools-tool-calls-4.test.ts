import { rm } from "node:fs/promises";

import {
  type AgentEvent,
  LiveDoc,
  MemoryStorage,
  type NestedToolExecutionResult,
  ToolTask,
  type ToolTaskInput,
  watchEvents,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import {
  directories,
  toolTasks,
  runOnce,
  DONE,
  call,
  tool,
  echoTool,
} from "./harness-nested-tools-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

function gatedLargeArgumentsBatch() {
  const setup = chatSetup();
  const hookEntered = deferred();
  const hookRelease = deferred();
  const running = deferred();
  const release = deferred();
  const large = "x".repeat(64 * 1024);
  addTool(
    setup.registry,
    tool("slow", async () => {
      running.resolve();
      await release.promise;
      return {};
    }),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: async (hookCall) => {
      if (hookCall.parent === undefined) return undefined;
      hookEntered.resolve();
      await hookRelease.promise;
      return { arguments: { text: large } };
    },
  });
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      await api.executeTool("slow", { text: "asked" }, callContext);
      return {};
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup, hookEntered, hookRelease, running, release, large };
}

describe("nested tool calls", () => {
  it("commits only the status of a nested call made with progress: false, and keeps its output in the result", async () => {
    const setup = chatSetup();
    const running = deferred();
    const release = deferred();
    addTool(
      setup.registry,
      tool("chatty", async (_args, api, callContext) => {
        api.output("line\n");
        api.diagnostic({ severity: "info", message: "note" });
        await api.details({ step: 1 }, callContext);
        running.resolve();
        await release.promise;
        return {};
      }),
    );
    let result: NestedToolExecutionResult | undefined;
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        result = await api.executeTool("chatty", {}, callContext, { progress: false });
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    // `details()` resolved before this, so a progress commit would have landed already.
    await running.promise;
    const [slot] = (await harness.snapshot(LiveDoc, root.id, context))!.nestedTools!;
    expect(slot).toEqual({
      callId: "c1/1",
      parentCallId: "c1",
      parentTaskId: expect.any(Number),
      name: "chatty",
      taskId: expect.any(Number),
      arguments: {},
      status: "running",
    });
    release.resolve();
    await submission.wait(context);
    expect(result).toMatchObject({
      structuredOutput: "line\n",
      details: { step: 1 },
      diagnostics: [{ severity: "info", message: "note" }],
    });
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("loses the running output of a nested call made with progress: false when it is aborted", async () => {
    const setup = chatSetup();
    const running = deferred();
    addTool(
      setup.registry,
      tool("chatty", async (_args, api, callContext) => {
        api.output("line\n");
        api.diagnostic({ severity: "info", message: "note" });
        await api.details({ step: 1 }, callContext);
        running.resolve();
        return aborted(callContext.abortSignal!);
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        void api.executeTool("chatty", {}, callContext, { progress: false }).catch(() => {});
        await running.promise;
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const stream = await watchEvents(harness, root.id, context);
    const ends: AgentEvent[] = [];
    stream.start((batch) => {
      ends.push(...batch.filter((event) => event.type === "tool_execution_end"));

      return Promise.resolve();
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    await harness.waitForIdle(context);
    await stream.stop();
    // The abort's result is built from the slot, which never got the output.
    const end = ends.find(
      (event) => event.type === "tool_execution_end" && event.toolCallId === "c1/1",
    );
    const result = (end as { result?: NestedToolExecutionResult }).result!;
    expect(result).toMatchObject({ isError: true });
    expect(result).not.toHaveProperty("structuredOutput");
    expect(result).not.toHaveProperty("details");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["aborted"]);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("shows a nested call's arguments in its slot: as made, then, unbounded, as it runs with them", async () => {
    const { setup, hookEntered, hookRelease, running, release, large } = gatedLargeArgumentsBatch();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const stream = await watchEvents(harness, root.id, context);
    const starts: AgentEvent[] = [];
    stream.start((batch) => {
      starts.push(...batch.filter((event) => event.type === "tool_execution_start"));

      return Promise.resolve();
    });
    const submission = await root.submit({ type: "input", content: "go" }, context);
    const slot = async () => (await harness.snapshot(LiveDoc, root.id, context))!.nestedTools![0]!;
    await hookEntered.promise;
    expect(await slot()).toMatchObject({ status: "pending", arguments: { text: "asked" } });
    hookRelease.resolve();
    await running.promise;
    expect(await slot()).toMatchObject({ status: "running", arguments: { text: large } });
    release.resolve();
    await submission.wait(context);
    await harness.waitForIdle(context);
    await stream.stop();
    // The start event carries the arguments the call runs with; the task input keeps the ones it was made with.
    const start = starts.find(
      (event) => event.type === "tool_execution_start" && event.toolCallId === "c1/1",
    );
    expect(start).toMatchObject({ args: { text: large } });
    const nested = (await toolTasks(harness)).find(
      (task) => (task.input as ToolTaskInput).kind === "nested",
    );
    expect(nested!.input as ToolTaskInput).toMatchObject({
      call: { arguments: { text: "asked" } },
    });
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("runs a nested call whose repaired arguments set an optional property to undefined", async () => {
    const setup = chatSetup();
    const seen: unknown[] = [];
    addTool(
      setup.registry,
      tool(
        "repaired",
        (args) => {
          seen.push(args);
          return Promise.resolve({});
        },
        {
          prepareArguments: () => {
            const repaired: { text?: string | undefined } = { text: undefined };
            return repaired as { text?: string };
          },
        },
      ),
    );
    let result: NestedToolExecutionResult | undefined;
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        result = await api.executeTool("repaired", { text: "x" }, callContext);
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    expect(result).toMatchObject({ isError: false });
    expect(seen).toEqual([{}]);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("finds each nested call's slot after slots in the middle were removed", async () => {
    const setup = chatSetup();
    addTool(setup.registry, echoTool().registration);
    addTool(
      setup.registry,
      tool("inner", async (_args, api, callContext) => {
        await api.executeTool("echo", { text: "m1" }, callContext);
        await api.executeTool("echo", { text: "m2" }, callContext);
        return {};
      }),
    );
    const before = deferred();
    const checked = deferred();
    let slots: { callId: string; status: string; summary?: unknown }[] = [];
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await api.executeTool("echo", { text: "n1" }, callContext);
        // n2 makes m1 and m2 and settles, which removes them from between n2 and n3.
        await api.executeTool("inner", {}, callContext);
        await api.executeTool("echo", { text: "n3" }, callContext);
        await api.executeTool("echo", { text: "n4" }, callContext);
        const live = await api.snapshot(LiveDoc, api.conversationId, callContext);
        slots = (live?.nestedTools ?? []).map(({ callId, status, summary }) => ({
          callId,
          status,
          summary,
        }));
        before.resolve();
        await checked.promise;
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await before.promise;
    const done = { status: "done", summary: { isError: false, durationMs: expect.any(Number) } };
    expect(slots).toEqual(
      ["c1/1", "c1/2", "c1/3", "c1/4"].map((callId) => Object.assign({ callId }, done)),
    );
    checked.resolve();
    await submission.wait(context);
    await harness.close(context);
  });
});
