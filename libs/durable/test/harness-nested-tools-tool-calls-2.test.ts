import { withAbortSignal } from "@msa/chord/context";
import {
  LiveDoc,
  type NestedToolExecutionResult,
  type ToolTaskInput,
  type ToolTaskResult,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
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
  echoTool,
} from "./harness-nested-tools-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

afterEach(async () => {
  for await (const directory of directories) await removeDir(directory);
  directories.clear();
});

async function interruptedCleanupBatch() {
  const { directory, path } = await makeTempFile("msa-durable-nested-", "session.sqlite");
  directories.add(directory);
  const setup = chatSetup();
  const running = deferred();
  const cleaning = deferred();
  const release = deferred();
  const counts: { hangRuns: number } = { hangRuns: 0 };
  addTool(
    setup.registry,
    tool("hang", async (_args, api, callContext) => {
      counts.hangRuns++;
      api.output("partial\n");
      await api.details({ step: 1 }, callContext);
      running.resolve();
      await aborted(callContext.abortSignal!).catch(() => {});
      // The caller's cleanup waits for this abort; hold it there until the Harness closes.
      cleaning.resolve();
      await release.promise;
      throw new Error("aborted");
    }),
  );
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      void api.executeTool("hang", {}, callContext).catch(() => {});
      await running.promise;
      return { output: [{ type: "text", text: "returned early" }] };
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { path, setup, cleaning, release, counts };
}

async function nestedSqlitePath() {
  const { directory, path } = await makeTempFile("msa-durable-nested-", "session.sqlite");
  directories.add(directory);
  return { path };
}

describe("nested tool calls", () => {
  it("aborts nested calls with their caller", async () => {
    const setup = chatSetup();
    const running = deferred();
    addTool(
      setup.registry,
      tool("hang", (_args, _api, callContext) => {
        running.resolve();
        return Promise.resolve(aborted(callContext.abortSignal!));
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await api.executeTool("hang", {}, callContext);
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await running.promise;
    await root.abort(context);
    expect((await submission.wait(context)).status).toBe("unanswered");
    const [parent, child] = await toolTasks(harness);
    const outcome = (record: typeof parent) =>
      record!.state.status === "terminal" ? record!.state.outcome : undefined;
    expect(outcome(child)).toMatchObject({ status: "aborted", result: { kind: "nested" } });
    expect(outcome(parent)).toMatchObject({ status: "aborted", result: { kind: "model" } });
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("aborts a running nested call when its caller throws", async () => {
    const setup = chatSetup();
    const running = deferred();
    addTool(
      setup.registry,
      tool("hang", (_args, _api, callContext) => {
        running.resolve();
        return Promise.resolve(aborted(callContext.abortSignal!));
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        void api.executeTool("hang", {}, callContext).catch(() => {});
        await running.promise;
        throw new Error("caller failed");
      }),
    );
    const { harness, status, entries } = await runOnce(setup, [call("batch"), DONE]);
    expect(status).toBe("done");
    expect(text(results(entries)[0])).toContain("caller failed");
    const [, child] = await toolTasks(harness);
    expect(child!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("reattaches a replay-safe caller to the nested calls it made before a restart", async () => {
    const { path } = await nestedSqlitePath();
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    const blocked = deferred();
    let runs = 0;
    addTool(
      setup.registry,
      tool(
        "batch",
        async (_args, api, callContext) => {
          runs++;
          const first = await api.executeTool("echo", { text: "a" }, callContext);
          if (runs === 1) {
            blocked.resolve();
            await aborted(callContext.abortSignal!);
          }
          // A call new to the rerun: its slot, after the reattached one's, is found and finishes.
          const second = await api.executeTool("echo", { text: "b" }, callContext);
          return {
            output: [{ type: "text", text: `run ${runs}: ${text(first)}, ${text(second)}` }],
          };
        },
        { replay: "safe" },
      ),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    let opened = await openChat(await openNodeSqliteStorage(path), setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await blocked.promise;
    await opened.harness.close(context);

    opened = await openChat(await openNodeSqliteStorage(path), setup);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(runs).toBe(2);
    expect(echo.state.runs).toBe(2);
    expect(text(results(await allEntries(opened.root))[0])).toBe("run 2: echo a, echo b");
    const tasks = await toolTasks(opened.harness);
    expect(tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested")).toHaveLength(2);
    const outcome = tasks[1]!.state.status === "terminal" ? tasks[1]!.state.outcome : undefined;
    expect((outcome?.result as ToolTaskResult | undefined)?.kind).toBe("nested");
    await opened.harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("stops only the wait when a caller cancels it; the call runs on and its key returns its result", async () => {
    const setup = chatSetup();
    const cancel = new AbortController();
    const release = deferred();
    const attempts: string[] = [];
    let retry: NestedToolExecutionResult | undefined;
    addTool(
      setup.registry,
      tool("slow", async () => {
        cancel.abort(new Error("cancelled"));
        await release.promise;
        return { output: [{ type: "text", text: "slow done" }] };
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        const cancelled = withAbortSignal(cancel.signal, callContext);
        await api.executeTool("slow", {}, cancelled, { key: "same" }).then(
          () => attempts.push("first done"),
          () => attempts.push("first cancelled"),
        );
        release.resolve();
        retry = await api.executeTool("slow", {}, callContext, { key: "same" });
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    expect(attempts).toEqual(["first cancelled"]);
    expect(retry).toMatchObject({ isError: false, structuredOutput: "slow done" });
    expect(await toolTasks(harness)).toHaveLength(2);
    await harness.close(context);
  });
});

describe("nested tool calls", () => {
  it("admits one nested call for a key used by concurrent calls", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    let both: NestedToolExecutionResult[] = [];
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        both = await Promise.all([
          api.executeTool("echo", { text: "a" }, callContext, { key: "k" }),
          api.executeTool("echo", { text: "a" }, callContext, { key: "k" }),
        ]);
        return {};
      }),
    );
    const { harness } = await runOnce(setup, [call("batch"), DONE]);
    expect(echo.state.runs).toBe(1);
    expect(both.map((result) => text(result))).toEqual(["echo a", "echo a"]);
    expect(await toolTasks(harness)).toHaveLength(2);
    await harness.close(context);
  });

  it("aborts left-running nested calls of a caller interrupted while it cleaned them up", async () => {
    const { path, setup, cleaning, release, counts } = await interruptedCleanupBatch();
    let opened = await openChat(await openNodeSqliteStorage(path), setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await cleaning.promise;
    const closed = opened.harness.close(context);
    release.resolve();
    await closed;

    opened = await openChat(await openNodeSqliteStorage(path), setup);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    await opened.harness.waitForIdle(context);
    // The caller is replay-unsafe: it reports the interruption, and its cleanup aborts the nested call.
    const [result] = results(await allEntries(opened.root));
    expect(result).toMatchObject({ toolCallId: "c1", isError: true });
    expect(text(result)).toContain("Tool batch was interrupted");
    const [, child] = await toolTasks(opened.harness);
    expect(child!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
    expect(counts.hangRuns).toBe(1);
    expect(await opened.harness.snapshot(LiveDoc, opened.root.id, context)).toEqual({});
    await opened.harness.close(context);
  });
});
