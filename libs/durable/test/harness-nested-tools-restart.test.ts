import { rm } from "node:fs/promises";

import type { Context } from "@msa/chord";
import { type AgentEvent, defineExtension, defineTask, type Harness, LiveDoc } from "@msa/durable";
import { ToolTask, watchEvents } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup } from "./chat-support.ts";
import {
  spawnThroughBatch,
  DONE,
  call,
  tool,
  Parameters,
  directories,
  sqlitePath,
  results,
  codes,
  nestedTasks,
  restartDuring,
  open,
} from "./harness-nested-tools-restart-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred, eventually } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// Collect tool end events from now on.
async function collectEnds(
  harness: Harness,
  conversationId: Parameters<Harness["conversation"]>[0],
) {
  const ends: Extract<AgentEvent, { type: "tool_execution_end" }>[] = [];
  const stream = await watchEvents(harness, conversationId, context);
  stream.start((batch) => {
    for (const event of batch) if (event.type === "tool_execution_end") ends.push(event);

    return Promise.resolve();
  });
  return { ends, stop: () => stream.stop() };
}

async function replayUnsafeBatch() {
  const path = await sqlitePath();
  const setup = chatSetup();
  const runs = { started: 0, gated: 0 };
  const running = deferred();
  const gated = deferred();
  // Replay-safe, so only the abandonment keeps it from rerunning.
  addTool(
    setup.registry,
    tool(
      "started",
      async (_args, api, callContext) => {
        runs.started++;
        api.output("partial\n");
        await api.details({ step: 1 }, callContext);
        running.resolve();
        return aborted(callContext.abortSignal!);
      },
      { replay: "safe" },
    ),
  );
  addTool(
    setup.registry,
    tool("gated", () => {
      runs.gated++;
      return Promise.resolve({});
    }),
  );
  // Holds `gated` in its `call` phase, before intent, until the Harness closes.
  addHooks(setup.registry, ToolTask, {
    beforeTool: (hookCall, _api, hookContext: Context) => {
      if (hookCall.name !== "gated") return Promise.resolve(undefined);
      gated.resolve();
      return Promise.resolve(aborted(hookContext.abortSignal!));
    },
  });
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      const first = api.executeTool("started", {}, callContext);
      const second = api.executeTool("gated", {}, callContext);
      await Promise.all([first, second]);
      return {};
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { path, setup, runs, running, gated };
}

async function lateWorkerSetup() {
  const path = await sqlitePath();
  const setup = chatSetup();
  const aborts: (string | undefined)[] = [];
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    name: "test.late",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: async (_task, runtime) => {
        started.resolve();
        await aborted(runtime.signal);
      },
    },
    abort: async (task, runtime, abortContext) => {
      aborts.push(task.abortReason);
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        abortContext,
      );
    },
  });
  const extension = defineExtension({ name: "late", tasks: [Worker] });
  setup.registry.install(extension);
  return { path, setup, aborts, started, Worker, extension };
}

describe("nested tool calls across a restart", () => {
  it("abandons a replay-unsafe caller's unfinished nested calls before they run again", async () => {
    const { path, setup, runs, running, gated } = await replayUnsafeBatch();
    const { opened, id } = await restartDuring(
      path,
      setup,
      Promise.all([running.promise, gated.promise]),
    );
    const { ends, stop } = await collectEnds(opened.harness, opened.root.id);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    await opened.harness.waitForIdle(context);
    await stop();
    expect(runs).toEqual({ started: 1, gated: 0 });
    const [started, gate] = await nestedTasks(opened.harness);
    for (const task of [started, gate]) {
      expect(task).toMatchObject({
        abandonOnRestart: true,
        abortRequested: true,
        abortReason: "restart",
      });
      expect(task!.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
    }
    const end = (callId: string) => ends.find((event) => event.toolCallId === callId)?.result;
    expect(codes(end("c1/1"))).toEqual(["interrupted"]);
    expect(end("c1/1")).toMatchObject({ isError: true, details: { step: 1 } });
    expect(end("c1/1")).not.toHaveProperty("structuredOutput");
    expect(codes(end("c1/2"))).toEqual(["abandoned"]);
    // The caller reports the interruption.
    const [result] = results(await allEntries(opened.root));
    expect(result).toMatchObject({ toolCallId: "c1", isError: true });
    expect(await opened.harness.snapshot(LiveDoc, opened.root.id, context)).toEqual({});
    await opened.harness.close(context);
  });
});

describe("nested tool calls across a restart", () => {
  it("abandons the work an abandoned nested call owns, which never runs a phase again", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const phases: string[] = [];
    const aborts: (string | undefined)[] = [];
    const started = deferred();
    const Worker = defineTask<null, { phase: "work" }, null>({
      name: "test.worker",
      version: 1,
      initial: () => ({ phase: "work" }),
      phases: {
        work: async (_task, runtime) => {
          phases.push("work");
          started.resolve();
          await aborted(runtime.signal);
        },
      },
      abort: async (task, runtime, abortContext) => {
        aborts.push(task.abortReason);
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          abortContext,
        );
      },
    });
    setup.registry.install(defineExtension({ name: "worker", tasks: [Worker] }));
    const spawned = spawnThroughBatch(setup, Worker);
    const { opened, id } = await restartDuring(path, setup, started.promise);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    await opened.harness.waitForIdle(context);
    expect(phases).toEqual(["work"]);
    // The cascade passed the restart reason on.
    expect(aborts).toEqual(["restart"]);
    expect((await opened.harness.getTask(spawned.worker!, context))?.state).toMatchObject({
      status: "terminal",
      outcome: { status: "aborted" },
    });
    await opened.harness.close(context);
  });
});

describe("nested tool calls across a restart", () => {
  it("keeps an abandoned task whose definition is missing waiting until it is installed, then runs its abort", async () => {
    const { path, setup, aborts, started, Worker, extension } = await lateWorkerSetup();
    const spawned = spawnThroughBatch(setup, Worker);
    let opened = await open(path, setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await started.promise;
    await opened.harness.close(context);

    setup.registry.uninstall(extension);
    opened = await open(path, setup);
    opened.harness.resume();
    await eventually(async () => {
      const inspected = (await opened.harness.inspect(context)).tasks.find(
        (task) => task.record.id === spawned.worker,
      );
      return inspected?.state.kind === "blocked";
    });
    expect((await opened.harness.getTask(spawned.worker!, context))?.state.status).not.toBe(
      "terminal",
    );
    expect(aborts).toEqual([]);
    setup.registry.install(extension);
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(aborts).toEqual(["restart"]);
    expect((await opened.harness.getTask(spawned.worker!, context))?.state).toMatchObject({
      status: "terminal",
      outcome: { status: "aborted" },
    });
    await opened.harness.close(context);
  });
});

describe("nested tool calls across a restart", () => {
  it("orphans an abandoned task whose definition is missing once an abort is requested", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const started = deferred();
    const Worker = defineTask<null, { phase: "work" }, null>({
      name: "test.gone",
      version: 1,
      initial: () => ({ phase: "work" }),
      phases: {
        work: async (_task, runtime) => {
          started.resolve();
          await aborted(runtime.signal);
        },
      },
      abort: async (_task, runtime, abortContext) => {
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          abortContext,
        );
      },
    });
    const extension = defineExtension({ name: "gone", tasks: [Worker] });
    setup.registry.install(extension);
    const spawned = spawnThroughBatch(setup, Worker);
    let opened = await open(path, setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await started.promise;
    await opened.harness.close(context);

    setup.registry.uninstall(extension);
    opened = await open(path, setup);
    opened.harness.resume();
    await eventually(async () => {
      const record = await opened.harness.getTask(spawned.worker!, context);
      return record?.abortReason === "restart";
    });
    await opened.root.abort(context);
    expect((await opened.harness.getTask(spawned.worker!, context))?.state).toMatchObject({
      status: "terminal",
      outcome: { status: "orphaned", reason: "missing_task" },
    });
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "unanswered",
    );
    await opened.harness.close(context);
  });
});
