import { rm } from "node:fs/promises";

import { defineExtension, defineTask, type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, type ChatSetup, chatSetup } from "./chat-support.ts";
import {
  DONE,
  call,
  tool,
  directories,
  sqlitePath,
  results,
  nestedTasks,
  restartDuring,
} from "./harness-nested-tools-restart-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// `echo` records its runs; `batch` calls it once without and once with a key and blocks on its first attempt. Its
// second attempt calls with other arguments first when `order` is "swapped". `last.seen` is what that attempt got.
function reattachingBatch(setup: ChatSetup, order: "same" | "swapped") {
  const runs: string[] = [];
  const blocked = deferred();
  const last: { seen: string[] } = { seen: [] };
  let callerRuns = 0;
  addTool(
    setup.registry,
    tool("echo", (args) => {
      runs.push(args.text ?? "");
      return Promise.resolve({ output: [{ type: "text", text: `echo ${args.text}` }] });
    }),
  );
  addTool(
    setup.registry,
    tool(
      "batch",
      async (_args, api, callContext) => {
        callerRuns++;
        const first = callerRuns === 2 && order === "swapped" ? "b" : "a";
        const one = await api.executeTool("echo", { text: first }, callContext);
        const named = await api.executeTool("echo", { text: "named" }, callContext, {
          key: "named",
        });
        if (callerRuns === 1) {
          blocked.resolve();
          await aborted(callContext.abortSignal!);
        }
        last.seen = [one, named].map((result) => result.structuredOutput as string);
        return {};
      },
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { runs, blocked, last };
}

async function backgroundWorkSetup() {
  const path = await sqlitePath();
  const setup = chatSetup();
  const started = deferred();
  const Background = defineTask<null, { phase: "work" }, null>({
    name: "test.background",
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
  setup.registry.install(defineExtension({ name: "background", tasks: [Background] }));
  return { path, setup, started, Background };
}

describe("nested tool calls across a restart", () => {
  it("reattaches a replay-safe caller by default and explicit keys, and rejects a rerun that calls differently", async () => {
    for await (const order of ["same", "swapped"] as const) {
      const path = await sqlitePath();
      const setup = chatSetup();
      const { runs, blocked, last } = reattachingBatch(setup, order);
      const { opened, id } = await restartDuring(path, setup, blocked.promise);
      opened.harness.resume();
      expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
        "done",
      );
      const [result] = results(await allEntries(opened.root));
      expect(runs).toEqual(["a", "named"]);
      if (order === "same") {
        expect(last.seen).toEqual(["echo a", "echo named"]);
        expect(result!.isError).toBe(false);
      } else {
        // Key 1 was made with other arguments: the rerun throws instead of reusing a different call's result.
        expect(result!.isError).toBe(true);
        expect(JSON.stringify(result!.content)).toContain(
          "Nested call c1/1 was already made with another tool",
        );
      }
      await opened.harness.close(context);
    }
  });
});

describe("nested tool calls across a restart", () => {
  it("abandons the child tasks a replay-unsafe tool created and awaited in memory", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const phases: string[] = [];
    const started = deferred();
    const Worker = defineTask<null, { phase: "work" }, null>({
      name: "test.direct-worker",
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
        phases.push(`abort ${task.abortReason}`);
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          abortContext,
        );
      },
    });
    setup.registry.install(defineExtension({ name: "direct-worker", tasks: [Worker] }));
    addTool(
      setup.registry,
      tool("work", async (_args, api, callContext) => {
        const id = await api.createTask(
          Worker,
          null,
          { ownership: { kind: "task", taskId: api.taskId } },
          callContext,
        );
        await api.waitForTask(id, callContext);
        return {};
      }),
    );
    setup.faux.setResponses([call("work"), DONE]);
    const { opened, id } = await restartDuring(path, setup, started.promise);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(phases).toEqual(["work", "abort restart"]);
    await opened.harness.close(context);
  });
});

describe("nested tool calls across a restart", () => {
  it("leaves background work under an abandoned nested call running, and settles without it", async () => {
    const { path, setup, started, Background } = await backgroundWorkSetup();
    let background: TaskId | undefined;
    addTool(
      setup.registry,
      tool("spawn", async (_args, api, callContext) => {
        // A conversation the call owns, with background work in it, as a persistent subagent has.
        background = await api.commit(async (tx) => {
          const child = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          return tx.createTask(Background, null, {
            conversationId: child.id,
            ownership: { kind: "conversation" },
            background: true,
          });
        }, callContext);
        return aborted(callContext.abortSignal!);
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await api.executeTool("spawn", {}, callContext);
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const { opened, id } = await restartDuring(path, setup, started.promise);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    const [spawn] = await nestedTasks(opened.harness);
    expect(spawn).toMatchObject({ abortReason: "restart", state: { status: "terminal" } });
    expect(await opened.harness.getTask(background!, context)).toMatchObject({
      abortRequested: false,
      state: { status: "running" },
    });
    await opened.harness.abortTask(background!, context);
    await opened.harness.close(context);
  });
});
