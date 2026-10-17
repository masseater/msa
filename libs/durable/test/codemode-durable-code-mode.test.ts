import { CodemodeSandbox } from "@msa/codemode";
import { ToolResultEntry, ToolTask, type ToolTaskInput } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  CodemodeJournalDoc,
  CodemodeRunDoc,
  type CodemodeToolDetails,
  createCodemodeTool,
} from "../src/codemode/codemode.ts";
import { allEntries, openChat } from "./chat-support.ts";
import { codemodeChat, tool } from "./codemode-chat-support.ts";
import {
  restart,
  resultText,
  scriptTask,
  DONE,
  script,
  sqlitePath,
  nestedCount,
  removeDirectories,
  openStoredChat,
} from "./codemode-support.ts";
import { addTool } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred, eventually } from "./task-support.ts";

afterEach(removeDirectories);

describe("durable code mode", () => {
  it("records a count the live run never recorded as soon as a replay acknowledges it", async () => {
    const chat = codemodeChat();
    const path = await sqlitePath();
    chat.setup.faux.setResponses([
      script(`await tools.echo({ text: "a" }); await tools.hold({});`),
      DONE,
    ]);
    let opened = await openStoredChat(path, chat.setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await chat.holds.reached.promise;
    await opened.harness.close(context);
    // As if result 1's count was never recorded; hold blocks again after the restart.
    chat.holds.reached = deferred();
    opened = await openStoredChat(path, chat.setup);
    const task = await scriptTask(opened.harness);
    await opened.harness.commit(async (tx) => {
      delete (await tx.doc(CodemodeJournalDoc, task)).entries[0]!.issuedAfter;
    }, context);
    opened.harness.resume();
    // The replay acknowledges result 1 and goes live; the script waits on hold, and the count is already recorded.
    await chat.holds.reached.promise;
    await eventually(
      async () =>
        (await opened.harness.snapshot(CodemodeJournalDoc, task, context))?.entries[0]
          ?.issuedAfter === 2,
    );
    await opened.harness.close(context);
    chat.holds.block = false;
    opened = await openStoredChat(path, chat.setup);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    await opened.harness.close(context);
  });
});

describe("durable code mode", () => {
  it("lists the script's tool calls in its result's details", async () => {
    const chat = codemodeChat();
    addTool(
      chat.setup.registry,
      tool("fails", () =>
        Promise.resolve({
          output: [{ type: "text", text: "permission denied" }],
          isError: true,
        }),
      ),
    );
    chat.setup.faux.setResponses([
      script(
        `await tools.echo({ text: "a" }); try { await tools.fails({}); } catch {} tools.hold({ id: 9 }); return 1;`,
      ),
      DONE,
    ]);
    const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
    const details = (entry.model![0] as { details?: CodemodeToolDetails }).details;
    // A call still running, or not yet launched, when the script ended shows as cancelled.
    expect(details?.calls).toMatchObject([
      { id: 1, name: "echo", args: '{"text":"a"}', status: "ok" },
      { id: 2, name: "fails", args: "{}", status: "error", error: "permission denied" },
      { id: 3, name: "hold", args: '{"id":9}', status: "cancelled" },
    ]);
    expect(details?.calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("stores no outcome when the host closes the sandbox, and replays the script after a restart", async () => {
    const chat = codemodeChat();
    const path = await sqlitePath();
    chat.setup.faux.setResponses([
      script(`await tools.echo({ text: "a" }); await tools.hold({}); return "done";`),
      DONE,
    ]);
    let opened = await openStoredChat(path, chat.setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await chat.holds.reached.promise;
    const task = await scriptTask(opened.harness);
    // A host shutting down closes the sandbox before the Harness.
    await chat.sandbox.close();
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect((await opened.harness.snapshot(CodemodeRunDoc, task, context))?.result).toBeUndefined();
    await opened.harness.close(context);
    // The next process has a new sandbox.
    chat.holds.block = false;
    addTool(
      chat.setup.registry,
      createCodemodeTool({ sandbox: new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024 }) }),
    );
    opened = await openStoredChat(path, chat.setup);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(await resultText(chat.setup, opened.root)).toEqual({ text: "done", isError: false });
    expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
    await opened.harness.close(context);
  });
});

describe("durable code mode", () => {
  it("aborts a call still running when the script ends", async () => {
    const chat = codemodeChat();
    chat.setup.faux.setResponses([
      script(`tools.hold({}); await tools.echo({ text: "a" }); return 1;`),
      DONE,
    ]);
    const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(await resultText(chat.setup, root)).toEqual({ text: "1", isError: false });
    const tasks = (
      await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context)
    ).items;
    const hold = tasks.find(
      (task) =>
        (task.input as ToolTaskInput).kind === "nested" &&
        (task.input as { call: { name: string } }).call.name === "hold",
    )!;
    expect(chat.holds.runs).toBe(1);
    expect(hold.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
    await harness.close(context);
  });

  it("admits no call once the script has ended, even one it made before ending", async () => {
    const chat = codemodeChat();
    chat.holds.block = false;
    const storage = new ControlledStorage();
    // Hold the fingerprint commit, and so the admission of the script's call, until the script has ended.
    chat.vm.onStart = (run) => {
      const held = storage.holdCommits();
      void run.result.then(() => held.release());
    };
    chat.setup.faux.setResponses([script(`tools.echo({ text: "late" }); return 1;`), DONE]);
    const { harness, root } = await openChat(storage, chat.setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(await resultText(chat.setup, root)).toEqual({ text: "1", isError: false });
    expect(chat.echo.size).toBe(0);
    expect(await nestedCount(harness)).toBe(0);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("checks a rerun's calls against an earlier attempt's before admitting any later call", async () => {
    const chat = codemodeChat();
    // With k set, call 1 has other arguments and call 2 is another tool than before; call 3 would be new.
    const { harness, result } = await restart(
      chat,
      `const k = load("k");
			tools.echo({ text: k ?? "a" });
			if (k) tools.echo({ text: "new" });
			await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: "x" };
          // As if the restart came before the first journal commit.
          (await tx.doc(CodemodeJournalDoc, task)).entries.length = 0;
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    // The first run already made more calls than before.
    expect(result.text).toContain("its first run made 3 calls, where it had made 2");
    expect(await nestedCount(harness)).toBe(2);
    expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
    await harness.close(context);
  });

  it("ends the call when a rerun makes a global call where an earlier attempt made a tool call", async () => {
    const chat = codemodeChat([{ name: "pick", execute: () => Promise.resolve(1) }]);
    const { harness, result } = await restart(
      chat,
      `if (load("k")) { await pick(); await tools.echo({ text: "new" }); } else { await tools.hold({}); }`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: true };
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("call 1 is pick(), but was tools.hold({})");
    expect(chat.echo.size).toBe(0);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("ends the call when a rerun's first run makes fewer calls than an earlier attempt admitted", async () => {
    // Live, the first run admits hold 1 and hold 2. With k set, it makes only hold 1, and after its result a global and a
    // new tool call: the global's ID is hold 2's key, which no check after the release would see.
    const chat = codemodeChat([{ name: "pick", execute: () => Promise.resolve(1) }]);
    const { harness, result } = await restart(
      chat,
      `const k = load("k");
			const first = tools.hold({ id: 1 });
			if (!k) tools.hold({ id: 2 });
			await first;
			await pick();
			await tools.echo({ text: "new" });`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: true };
        }, context);
      },
      async (opened, task) => {
        await eventually(
          async () => (await opened.snapshot(CodemodeJournalDoc, task, context))?.firstIssued === 2,
        );
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("its first run made 1 calls, where it had made 2");
    expect(chat.echo.size).toBe(0);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("ends the call when a rerun without journal entries ends in its first run, where it went on before", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `if (load("k")) { store("x", 1); return "early"; } await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: true };
        }, context);
      },
      async (opened, task) => {
        await eventually(
          async () => (await opened.snapshot(CodemodeJournalDoc, task, context))?.firstIssued === 1,
        );
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("it ended after result 0, where it went on before");
    await harness.close(context);
  });
});
