import { rm } from "node:fs/promises";

import { GenerationTask, LiveDoc, ToolTask } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { addHooks, addTool, type Installed } from "./harness-support.ts";
import {
  DONE,
  call,
  text,
  results,
  toolTaskId,
  open,
  tool,
  blockingTool,
  directories,
  sqlitePath,
} from "./harness-tools-recovery-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// A replay-safe tool that records the cwd of each run and holds its first run until aborted.
function rerunningWorkChat(path: string) {
  const setup = chatSetup();
  const cwds: (string | undefined)[] = [];
  const started = deferred();
  const work = tool(
    "work",
    async (_args, api, callContext) => {
      cwds.push(api.env?.cwd);
      if (cwds.length === 1) {
        started.resolve();
        await aborted(callContext.abortSignal!);
      }
      return {};
    },
    { replay: "safe" },
  );
  addTool(setup.registry, work);
  setup.faux.setResponses([call("work"), DONE]);
  const env = ({ cwd = "/" }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd });
  const reopen = async () => {
    const opened = await openChat(await openNodeSqliteStorage(path), setup, { env });
    opened.harness.resume();
    return opened;
  };
  return { cwds, started, reopen };
}

describe("tool recovery", () => {
  it("answers an unsafe tool interrupted after intent with its durable partial output", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const { registration, started, state } = blockingTool("work");
    addTool(setup.registry, registration);
    setup.faux.setResponses([call("work"), DONE]);
    let opened = await open(path, setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await started.promise;
    const taskId = await toolTaskId(opened.harness);
    await opened.harness.close(context);

    opened = await open(path, setup);
    expect((await opened.harness.getTask(taskId, context))?.state).toMatchObject({
      checkpoint: { phase: "execute", arguments: {}, replay: "unsafe" },
    });
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(state.runs).toBe(1);
    const [result] = results(await allEntries(opened.root));
    expect(result).toMatchObject({ isError: true, details: { run: 1 } });
    expect(text(result)).toBe(
      "run 1\n|<harness>\n[error] Tool work was interrupted and may have partially run\n</harness>",
    );
    expect(await opened.harness.snapshot(LiveDoc, opened.root.id, context)).toEqual({});
    await opened.harness.close(context);
  });
});

describe("tool recovery", () => {
  it("reruns a tool only when both the stored and the current replay policy are safe", async () => {
    const cases: [stored: "safe" | "unsafe", current: "safe" | "unsafe", reruns: boolean][] = [
      ["safe", "safe", true],
      ["safe", "unsafe", false],
      ["unsafe", "safe", false],
    ];
    for await (const [stored, current, reruns] of cases) {
      const path = await sqlitePath();
      const setup = chatSetup();
      const blocking = blockingTool("work", { replay: stored });
      const registration: Installed = addTool(setup.registry, blocking.registration);
      setup.faux.setResponses([call("work"), DONE]);
      let opened = await open(path, setup);
      const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
      await blocking.started.promise;
      await opened.harness.close(context);

      registration.dispose();
      addTool(setup.registry, { ...blocking.registration, replay: current });
      opened = await open(path, setup);
      expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
        "done",
      );
      const [result] = results(await allEntries(opened.root));
      expect(blocking.state.runs).toBe(reruns ? 2 : 1);
      expect(result!.isError).toBe(!reruns);
      if (reruns) expect(text(result)).toBe("run 2\n");
      await opened.harness.close(context);
    }
  });
});

describe("tool recovery", () => {
  it("reruns a safe tool with the environment of the conversation's cwd at rerun, and not once it is deselected", async () => {
    for await (const change of ["cwd", "deselect"] as const) {
      const path = await sqlitePath();
      const { cwds, started, reopen } = rerunningWorkChat(path);
      let opened = await reopen();
      await opened.root.configure({ cwd: "/one" }, context);
      const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
      await started.promise;
      await opened.root.configure(change === "cwd" ? { cwd: "/two" } : { extensions: [] }, context);
      await opened.harness.close(context);

      opened = await reopen();
      expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
        "done",
      );
      const [result] = results(await allEntries(opened.root));
      if (change === "cwd") {
        expect(cwds).toEqual(["/one", "/two"]);
        expect(result!.isError).toBe(false);
      } else {
        // A tool that no longer resolves is treated as unsafe: interrupted, not rerun.
        expect(cwds).toEqual(["/one"]);
        expect(text(result)).toContain("was interrupted");
      }
      await opened.harness.close(context);
    }
  });
});

describe("tool recovery", () => {
  it("reruns beforeTool when interrupted before intent, and executes once", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    let runs = 0;
    addTool(
      setup.registry,
      tool("work", () => {
        runs++;
        return Promise.resolve({ output: [] });
      }),
    );
    const reached = deferred();
    let asked = 0;
    const decisions: string[] = [];
    addHooks(setup.registry, ToolTask, {
      beforeTool: async (_call, api, callContext) => {
        asked++;
        // A durable first-writer-wins decision survives the rerun.
        decisions.push(await api.memo("test:decision", `attempt ${asked}`, callContext));
        if (asked === 1) {
          reached.resolve();
          await aborted(callContext.abortSignal!);
        }
        return undefined;
      },
    });
    setup.faux.setResponses([call("work"), DONE]);
    let opened = await open(path, setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await reached.promise;
    await opened.harness.close(context);

    opened = await open(path, setup);
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect([asked, runs]).toEqual([2, 1]);
    expect(decisions).toEqual(["attempt 1", "attempt 1"]);
    await opened.harness.close(context);
  });
});

describe("tool recovery", () => {
  it("reruns the generation tools phase interrupted before its commit", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("work", () => Promise.resolve({ output: [] })),
    );
    const reached = deferred();
    let observed = 0;
    addHooks(setup.registry, GenerationTask, {
      afterTools: async (_assistant, _results, _api, callContext) => {
        observed++;
        if (observed === 1) {
          reached.resolve();
          await aborted(callContext.abortSignal!);
        }
      },
    });
    setup.faux.setResponses([call("work"), DONE]);
    let opened = await open(path, setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await reached.promise;
    await opened.harness.close(context);

    opened = await open(path, setup);
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(observed).toBe(2);
    expect((await allEntries(opened.root)).map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.system",
      "msa.assistant",
      "msa.tool-result",
      "msa.assistant",
    ]);
    await opened.harness.close(context);
  });
});

describe("tool recovery", () => {
  it("answers an aborted tool with its partial output and continues the run", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const { registration, started } = blockingTool("work");
    addTool(setup.registry, registration);
    setup.faux.setResponses([call("work"), DONE]);
    const opened = await open(path, setup);
    const submission = await opened.root.submit({ type: "input", content: "go" }, context);
    await started.promise;
    const taskId = await toolTaskId(opened.harness);
    expect(await opened.harness.abortTask(taskId, context)).toBe("marked");
    expect((await opened.harness.waitForTask(taskId, context)).state.outcome).toMatchObject({
      status: "aborted",
      result: { entryId: expect.any(Number) },
    });
    expect((await submission.wait(context)).status).toBe("done");
    const [result] = results(await allEntries(opened.root));
    expect(text(result)).toBe("run 1\n|<harness>\n[error] Tool work was aborted\n</harness>");
    await opened.harness.close(context);
  });
});
