import { type Usage } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import { LiveDoc, MemoryStorage, type NestedToolExecutionResult, ToolTask } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { toolTasks, runOnce, DONE, call, tool, echoTool } from "./harness-nested-tools-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

function summarizedTools() {
  const setup = chatSetup();
  const release = deferred();
  const checked = deferred();
  // Diagnostics win over output for the error text, which is cut to 500 characters.
  addTool(
    setup.registry,
    tool("verbose", () =>
      Promise.resolve({
        output: [{ type: "text", text: "ignored" }],
        isError: true,
        diagnostics: [{ severity: "error", message: "e".repeat(600) }],
      }),
    ),
  );
  const usage: Usage = {
    input: 1,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 3,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
  };
  return { setup, release, checked, usage };
}

function summarizedBatch() {
  const { setup, release, checked, usage } = summarizedTools();
  addTool(setup.registry, echoTool().registration);
  addTool(
    setup.registry,
    tool("paid", () => Promise.resolve({ usage })),
  );
  // An error with mixed content: programs get the list, the summary its text.
  addTool(
    setup.registry,
    tool("broken", () =>
      Promise.resolve({
        output: [
          { type: "text", text: "bad image" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
        isError: true,
      }),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      await api.executeTool("echo", { text: "a" }, callContext);
      await api.executeTool("missing", {}, callContext);
      await api.executeTool("paid", {}, callContext);
      await api.executeTool("broken", {}, callContext);
      await api.executeTool("verbose", {}, callContext);
      checked.resolve();
      await release.promise;
      return {};
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup, release, checked, usage };
}

describe("nested tool calls", () => {
  it("gives callers a result with its task ID and only diagnostics for a nested call the scheduler faulted", async () => {
    const setup = chatSetup();
    // Details that are not JSON make the result commit throw, so the task faults and stores no result.
    addTool(
      setup.registry,
      tool("echo", () => Promise.resolve({ details: { count: 1n } as unknown as JsonValue })),
    );
    let result: NestedToolExecutionResult | undefined;
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        result = await api.executeTool("echo", { text: "a" }, callContext);
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const [, child] = await toolTasks(harness);
    expect(child!.state).toMatchObject({ status: "terminal", outcome: { status: "faulted" } });
    expect(result).toEqual({
      taskId: child!.id,
      isError: true,
      diagnostics: [
        {
          severity: "error",
          code: "faulted",
          message: expect.stringContaining("Tool echo failed"),
        },
      ],
    });
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("gives callers what a schema-less tool streamed before it threw", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("fails", (_args, api) => {
        api.output("half way\n");
        return Promise.reject(new Error("broke"));
      }),
    );
    let result: NestedToolExecutionResult | undefined;
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        result = await api.executeTool("fails", {}, callContext);
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    expect(result).toMatchObject({
      isError: true,
      structuredOutput: "half way\n",
      diagnostics: [{ code: "tool_error", message: "broke" }],
    });
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("shows a finished nested call as a done slot with its summary until its caller settles", async () => {
    const { setup, release, checked, usage } = summarizedBatch();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await checked.promise;
    const slots = (await harness.snapshot(LiveDoc, root.id, context))!.nestedTools!;
    expect(slots.map(({ callId, status, summary }) => ({ callId, status, summary }))).toEqual([
      {
        callId: "c1/1",
        status: "done",
        summary: { isError: false, durationMs: expect.any(Number) },
      },
      {
        callId: "c1/2",
        status: "done",
        summary: { isError: true, error: "Tool missing is not available" },
      },
      {
        callId: "c1/3",
        status: "done",
        summary: { isError: false, durationMs: expect.any(Number), usage },
      },
      {
        callId: "c1/4",
        status: "done",
        summary: { isError: true, durationMs: expect.any(Number), error: "bad image" },
      },
      {
        callId: "c1/5",
        status: "done",
        summary: { isError: true, durationMs: expect.any(Number), error: "e".repeat(500) },
      },
    ]);
    release.resolve();
    await submission.wait(context);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });

  it("migrates version 1 tool task input to a model-issued call", () => {
    const migrate = ToolTask.definition.migrate!;
    expect(migrate({ assistant: 3, callId: "c1" }, { phase: "call" }, 1)).toEqual({
      input: { kind: "model", assistant: 3, callId: "c1" },
      checkpoint: { phase: "call" },
    });
  });
});
