import { ToolResultEntry } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CodemodeRunDoc } from "../src/codemode/codemode.ts";
import { allEntries } from "./chat-support.ts";
import { codemodeChat } from "./codemode-chat-support.ts";
import {
  resultText,
  scriptTask,
  DONE,
  script,
  sqlitePath,
  removeDirectories,
  openStoredChat,
} from "./codemode-support.ts";
import { addHooks } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(removeDirectories);

describe("durable code mode", () => {
  it("returns a decided outcome after a restart without running the script again", async () => {
    const chat = codemodeChat();
    const path = await sqlitePath();
    chat.holds.block = false;
    chat.setup.faux.setResponses([script(`return "first"`), DONE]);
    // Stop after execute() returned, so after the outcome is stored, and before the result commits.
    const stopped = { block: true, reached: deferred() };
    addHooks(chat.setup.registry, ToolTask, {
      afterTool: async (call, _result, _api, hookContext) => {
        if (call.name !== "codemode" || !stopped.block) return undefined;
        stopped.reached.resolve();
        await aborted(hookContext.abortSignal!);
        return undefined;
      },
    });
    let opened = await openStoredChat(path, chat.setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await stopped.reached.promise;
    const task = await scriptTask(opened.harness);
    expect((await opened.harness.snapshot(CodemodeRunDoc, task, context))?.result).toBeDefined();
    await opened.harness.close(context);
    stopped.block = false;
    opened = await openStoredChat(path, chat.setup);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(await resultText(chat.setup, opened.root)).toEqual({ text: "first", isError: false });
    expect(chat.vm.starts).toBe(1);
    await opened.harness.close(context);
  });
});

describe("durable code mode", () => {
  it("keeps store() values per conversation, as of a fork's entry", async () => {
    const chat = codemodeChat();
    chat.holds.block = false;
    chat.setup.faux.setResponses([
      script(`store("k", 1); return load("k")`),
      DONE,
      script(`return [load("k") ?? null]`),
      DONE,
    ]);
    const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup);
    await (await root.submit({ type: "input", content: "first" }, context)).wait(context);
    const firstUser = (await allEntries(root)).find((entry) => entry.kind === "msa.user")!;
    await (await root.submit({ type: "input", content: "second" }, context)).wait(context);
    const results = (await allEntries(root)).filter((entry) => ToolResultEntry.is(entry));
    const texts = results.map(
      (entry) => (entry.model![0] as { content: { text: string }[] }).content[1]!.text,
    );
    expect(texts).toEqual(["1", "[1]"]);
    // A fork at the first input is from before the first script stored anything.
    chat.setup.faux.setResponses([script(`return [load("k") ?? null]`), DONE]);
    const fork = await root.fork(firstUser.id, { ownership: { kind: "ownerless" } }, context);
    await (await fork.submit({ type: "input", content: "fork" }, context)).wait(context);
    const forkResult = (await allEntries(fork))
      .filter((entry) => ToolResultEntry.is(entry))
      .at(-1)!;
    expect((forkResult.model![0] as { content: { text: string }[] }).content[1]!.text).toBe(
      "[null]",
    );
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("journals results that finish together in one commit", async () => {
    const release = deferred();
    let waiting = 0;
    const chat = codemodeChat([
      {
        name: "wait",
        execute: async () => {
          if (++waiting === 50) release.resolve();
          await release.promise;
          return null;
        },
      },
    ]);
    chat.holds.block = false;
    chat.setup.faux.setResponses([
      script(`return (await Promise.all(Array.from({ length: 50 }, () => wait()))).length`),
      DONE,
    ]);
    const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup);
    let journalCommits = 0;
    harness.subscribeCommits((publication) => {
      for (const change of publication.changes) {
        if (change.type === "document" && change.record.kind === "msa.codemode.journal")
          journalCommits++;
      }
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(await resultText(chat.setup, root)).toEqual({ text: "50", isError: false });
    // The journal's creation and a few groups, not one commit per result (51).
    expect(journalCommits).toBeLessThan(10);
    await harness.close(context);
  });
});
