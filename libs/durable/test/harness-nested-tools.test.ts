import { rm } from "node:fs/promises";

import {
  LiveDoc,
  MemoryStorage,
  NestedCallDoc,
  type NestedToolExecutionResult,
  type TaskId,
  type ToolHookCall,
  ToolTask,
  type ToolTaskInput,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import {
  directories,
  results,
  toolTasks,
  runOnce,
  text,
  DONE,
  call,
  tool,
  echoTool,
} from "./harness-nested-tools-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("nested tool calls", () => {
  it("stores one document per nested call, keyed by its key, written only by that call", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await Promise.all([
          api.executeTool("echo", { text: "a" }, callContext),
          api.executeTool("echo", { text: "b" }, callContext, { key: "named" }),
        ]);
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const storage = new MemoryStorage();
    // Per document written, the keys of the nested calls it holds.
    const written: { kind: string; key: string | undefined }[] = [];
    const commit = storage.commit.bind(storage);
    storage.commit = (writes, commitContext) => {
      for (const write of writes) {
        if (write.type === "document.create")
          written.push({ kind: write.record.kind, key: write.record.key });
      }
      return commit(writes, commitContext);
    };
    const { harness, root } = await openChat(storage, setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const nested = written.filter((write) => write.kind.startsWith("msa.tool."));
    expect(nested).toEqual([
      { kind: NestedCallDoc.definition.kind, key: "1" },
      { kind: NestedCallDoc.definition.kind, key: "named" },
    ]);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("rejects a nested call of an aborted caller and leaves no document for it", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    const started = deferred();
    const marked = deferred();
    let rejected: unknown;
    let caller: TaskId | undefined;
    addTool(
      setup.registry,
      tool("late", async (_args, api) => {
        caller = api.taskId;
        started.resolve();
        await marked.promise;
        // Its context is aborted too, so pass one that is not: the admission itself must refuse.
        try {
          await api.executeTool("echo", { text: "a" }, context);
        } catch (error) {
          rejected = error;
        }
        return {};
      }),
    );
    setup.faux.setResponses([call("late"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await started.promise;
    await harness.commit(async (tx) => {
      const record = (await tx.task(caller!))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...record,
        abortRequested: true,
      });
    }, context);
    marked.resolve();
    await submission.wait(context);
    expect(String(rejected)).toMatch(/abort mark|aborted|has settled/u);
    expect(await harness.snapshot(NestedCallDoc, caller!, "1", context)).toBeUndefined();
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("runs a nested call as its own tool task and returns its result to the caller, not the transcript", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    let nested: NestedToolExecutionResult | undefined;
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        nested = await api.executeTool("echo", { text: "a" }, callContext);
        return { output: [{ type: "text", text: `got ${text(nested)}` }] };
      }),
    );
    const { harness, root, status, entries } = await runOnce(setup, [call("batch"), DONE]);
    expect(status).toBe("done");
    const [parent, child] = await toolTasks(harness);
    expect(nested).toEqual({
      taskId: child!.id,
      structuredOutput: "echo a",
      isError: false,
      diagnostics: [],
      durationMs: expect.any(Number),
    });
    // One result entry: the model-issued call's, which records nothing of its nested calls.
    expect(results(entries).map((result) => [result.toolCallId, text(result)])).toEqual([
      ["c1", "got echo a"],
    ]);
    expect(results(entries)[0]).not.toHaveProperty("nestedCalls");
    expect(parent!.input).toMatchObject({ kind: "model", callId: "c1" });
    expect(child!.owner).toBe(parent!.id);
    expect(child!.input as ToolTaskInput).toEqual({
      kind: "nested",
      parent: parent!.id,
      parentCallId: "c1",
      key: "1",
      call: { type: "toolCall", id: "c1/1", name: "echo", arguments: { text: "a" } },
    });
    // The receipt stays small: the result lived in the caller's documents, which retired with it.
    expect(child!.state).toEqual({
      status: "terminal",
      outcome: { status: "completed", result: { kind: "nested" } },
    });
    expect(await harness.snapshot(NestedCallDoc, parent!.id, "1", context)).toBeUndefined();
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("gives each nested call its own task and call ID", async () => {
    const setup = chatSetup();
    const seen: { taskId: TaskId; callId: string }[] = [];
    addTool(
      setup.registry,
      tool("who", (_args, api) => {
        seen.push({ taskId: api.taskId, callId: api.callId });
        return Promise.resolve({});
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await Promise.all([
          api.executeTool("who", {}, callContext, { key: "a" }),
          api.executeTool("who", {}, callContext, { key: "b" }),
        ]);
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    expect(seen.map((each) => each.callId).sort()).toEqual(["c1/a", "c1/b"]);
    expect(new Set(seen.map((each) => each.taskId)).size).toBe(2);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("runs the tool hooks on nested calls, which see their parent", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    const parents: ToolHookCall["parent"][] = [];
    addHooks(setup.registry, ToolTask, {
      beforeTool: (hookCall) => {
        parents.push(hookCall.parent);
        return hookCall.parent !== undefined && hookCall.arguments["text"] === "secret"
          ? { block: "no secrets" }
          : undefined;
      },
      afterTool: (hookCall, result) =>
        hookCall.parent === undefined
          ? undefined
          : { ...result, output: [{ type: "text", text: "rewritten" }] },
    });
    const nested: NestedToolExecutionResult[] = [];
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        nested.push(await api.executeTool("echo", { text: "secret" }, callContext));
        nested.push(await api.executeTool("echo", { text: "public" }, callContext));
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    const [parent] = await toolTasks(harness);
    expect(parents).toEqual([
      undefined,
      { taskId: parent!.id, callId: "c1" },
      { taskId: parent!.id, callId: "c1" },
    ]);
    expect(nested[0]).toMatchObject({
      isError: true,
      diagnostics: [
        { severity: "error", code: "blocked", message: "Tool call blocked: no secrets" },
      ],
    });
    expect(text(nested[1])).toBe("rewritten");
    expect(echo.state.runs).toBe(1);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("returns an error result for an unavailable tool and invalid arguments", async () => {
    const setup = chatSetup();
    addTool(setup.registry, echoTool().registration);
    const nested: NestedToolExecutionResult[] = [];
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        nested.push(await api.executeTool("missing", {}, callContext));
        nested.push(await api.executeTool("echo", { text: { not: "a string" } }, callContext));
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    expect(nested.map((result) => [result.isError, result.diagnostics[0]?.code])).toEqual([
      [true, "tool_unavailable"],
      [true, "invalid_arguments"],
    ]);
    await harness.close(context);
  });

  it("returns the call a key already names, and rejects reusing the key for another call", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    let reused: NestedToolExecutionResult | undefined;
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await api.executeTool("echo", { text: "a" }, callContext, { key: "k" });
        reused = await api.executeTool("echo", { text: "a" }, callContext, { key: "k" });
        await api.executeTool("echo", { text: "b" }, callContext, { key: "k" });
        return {};
      }),
    );
    const { harness, entries } = await runOnce(setup, [call("batch"), DONE]);
    expect(echo.state.runs).toBe(1);
    expect(text(reused)).toBe("echo a");
    expect(text(results(entries)[0])).toContain(
      "Nested call c1/k was already made with another tool or other arguments",
    );
    await harness.close(context);
  });
});
